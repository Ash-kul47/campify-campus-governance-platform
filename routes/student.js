const express = require("express");
const router = express.Router();
const pool = require("../db");
const upload = require("../utils/upload");

const calculateComplaintPriority = require("../utils/priorityEngine");

// ---------- AUTH MIDDLEWARE ----------
function isloggedin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).send("You must be logged in ");
    }
    next();
}

function isAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).send("Access denied: Admins only");
    }
    next();
}

function isStudent(req, res, next) {
    if (!req.session.user || req.session.user.role !== "student") {
        return res.status(403).send("Access denied: Students only");
    }
    next();
}

// ---------- STUDENT DASHBOARD ----------
router.get("/dashboard", isloggedin, isStudent, async (req, res) => {
    try {
        const userId = req.session.user.id;

        // 🔹 My complaints
        const complaintsResults = await pool.query(`
            SELECT 
                c.*, u.public_id,
                COUNT(DISTINCT v.id) AS upvotes,
                json_agg(
                    json_build_object(
                        'file_path', p.file_path,
                        'file_type', p.file_type
                    )
                ) FILTER (WHERE p.id IS NOT NULL) AS proofs
            FROM complaints c
            JOIN users u ON c.user_id = u.id
            LEFT JOIN complaint_proofs p ON c.id = p.complaint_id
            LEFT JOIN complaint_votes v ON c.id = v.complaint_id
            WHERE c.user_id = $1 AND c.is_ticket = false
            GROUP BY c.id, u.public_id
            ORDER BY c.created_at DESC
        `, [userId]);

        // 🔹 All complaints (for upvoting)
        const allComplaints = await pool.query(`
            SELECT 
                c.*, u.public_id,
                COUNT(DISTINCT v.id) AS upvotes,
                COALESCE(BOOL_OR(v.user_id = $1), false) AS has_upvoted,
                json_agg(
                    json_build_object(
                        'file_path', p.file_path,
                        'file_type', p.file_type
                    )
                ) FILTER (WHERE p.id IS NOT NULL) AS proofs
            FROM complaints c
            JOIN users u ON c.user_id = u.id
            LEFT JOIN complaint_proofs p ON c.id = p.complaint_id
            LEFT JOIN complaint_votes v ON c.id = v.complaint_id
            WHERE c.is_ticket = false
            GROUP BY c.id, u.public_id
            ORDER BY c.created_at DESC
        `, [userId]);

        // 🔹 My tickets
        const mytickets = await pool.query(`
            SELECT 
                c.*, u.public_id,
                t.ticket_deadline,
                json_agg(
                    json_build_object(
                        'file_path', p.file_path,
                        'file_type', p.file_type
                    )
                ) FILTER (WHERE p.id IS NOT NULL) AS proofs
            FROM complaints c
            JOIN users u ON c.user_id = u.id
            JOIN tickets t ON c.id = t.complaint_id
            LEFT JOIN complaint_proofs p ON c.id = p.complaint_id
            WHERE c.user_id = $1
            GROUP BY c.id, u.public_id, t.ticket_deadline
            ORDER BY c.created_at DESC
        `, [userId]);

        res.render("student_dashboard", {
            user: req.session.user,
            complaints: complaintsResults.rows,
            allComplaints: allComplaints.rows,
            myTickets: mytickets.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading student dashboard");
    }
});

// ---------- TICKET ----------
router.get("/ticket/new", isloggedin, isStudent, (req, res) => {
    res.render("ticket_form");
});

router.post("/ticket", isloggedin, isStudent, upload.single("proof"), async (req, res) => {
    const {
        title, description, category, location,
        student_name, student_class,
        contact_email, contact_number
    } = req.body;

    const user_id = req.session.user.id;

    try {
        const existingTicket = await pool.query(`
            SELECT c.id
            FROM complaints c
            WHERE c.user_id = $1
            AND c.is_ticket = true
            AND c.status IN ('Pending', 'In Progress')
        `, [user_id]);

        if (existingTicket.rows.length > 0) {
            return res.status(400).send("You already have an active ticket.");
        }

        const complaint_result = await pool.query(
            `INSERT INTO complaints(title,description,category,location,user_id,is_ticket)
             VALUES($1,$2,$3,$4,$5,true)
             RETURNING id`,
            [title, description, category, location, user_id]
        );

        const complaint_id = complaint_result.rows[0].id;

        const deadline_result = await pool.query(
            `SELECT now() + interval '48 hours' AS deadline`
        );

        const ticket_deadline = deadline_result.rows[0].deadline;

        if (req.file) {
            await pool.query(
                `INSERT INTO complaint_proofs (complaint_id, file_path, file_type)
                 VALUES ($1, $2, $3)`,
                [complaint_id, req.file.path, req.file.mimetype]
            );
        }

        await pool.query(
            `INSERT INTO tickets
             (complaint_id,student_name,student_class,contact_email,contact_number,ticket_deadline)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [complaint_id, student_name, student_class, contact_email, contact_number, ticket_deadline]
        );

        res.redirect("/student/dashboard");

    } catch (err) {
        console.error(err);
        res.status(500).send("Error creating ticket");
    }
});

// ---------- COMPLAINT ----------
router.get("/complaint/new", isloggedin, isStudent, (req, res) => {
    res.render("complaint_form");
});

router.post("/complaint", isloggedin, isStudent, upload.single("proof"), async (req, res) => {
    const { title, description, category, location } = req.body;
    const user_id = req.session.user.id;

    try {
        const result = await pool.query(
            `INSERT INTO complaints(title,description,category,location,user_id)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING *`,
            [title, description, category, location, user_id]
        );

        const complaint = result.rows[0];

        if (req.file) {
            await pool.query(
                `INSERT INTO complaint_proofs (complaint_id, file_path, file_type)
                 VALUES ($1, $2, $3)`,
                [complaint.id, req.file.path, req.file.mimetype]
            );
        }

        const proofCount = await pool.query(
            `SELECT COUNT(*) FROM complaint_proofs WHERE complaint_id = $1`,
            [complaint.id]
        );

        const newPriority = calculateComplaintPriority({
            ...complaint,
            proof_count: parseInt(proofCount.rows[0].count)
        });

        await pool.query(
            `UPDATE complaints SET priority_score = $1 WHERE id = $2`,
            [newPriority, complaint.id]
        );

        res.redirect("/student/dashboard");

    } catch (err) {
        console.error(err);
        res.status(500).send("Error submitting complaint");
    }
});

// ---------- UPVOTE (FIXED) ----------
router.post("/complaints/:id/upvote", isloggedin, isStudent, async (req, res) => {
    const complaintId = req.params.id;
    const userId = req.session.user.id;

    try {
        await pool.query("BEGIN");

        const existingVote = await pool.query(
            `SELECT * FROM complaint_votes 
             WHERE complaint_id = $1 AND user_id = $2`,
            [complaintId, userId]
        );

        if (existingVote.rows.length > 0) {
            await pool.query(
                `DELETE FROM complaint_votes 
                 WHERE complaint_id = $1 AND user_id = $2`,
                [complaintId, userId]
            );
        } else {
            await pool.query(
                `INSERT INTO complaint_votes (complaint_id, user_id)
                 VALUES ($1, $2)`,
                [complaintId, userId]
            );
        }

        const voteResult = await pool.query(
            `SELECT COUNT(*) AS upvotes 
             FROM complaint_votes 
             WHERE complaint_id = $1`,
            [complaintId]
        );

        const upvotes = parseInt(voteResult.rows[0].upvotes);

        const complaintResult = await pool.query(
            `SELECT * FROM complaints WHERE id = $1`,
            [complaintId]
        );

        const complaint = complaintResult.rows[0];

        const newPriority = calculateComplaintPriority({
            ...complaint,
            upvotes: upvotes
        });

        await pool.query(
            `UPDATE complaints SET priority_score = $1 WHERE id = $2`,
            [newPriority, complaintId]
        );

        await pool.query("COMMIT");

        res.redirect("/student/dashboard");

    } catch (err) {
        await pool.query("ROLLBACK");
        console.error(err);
        res.status(500).send("Error while upvoting");
    }
});

module.exports = router;
