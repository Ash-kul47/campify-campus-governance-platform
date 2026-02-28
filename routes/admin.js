const express = require("express");
const router = express.Router();
const pool = require("../db");


const calculateComplaintPriority = require("../utils/priorityEngine");

function isloggedin(req,res,next){
    if(!req.session.user){
        return res.status(401).send("You must be logged in ")
    }
    next();//allows request to continue
}

//check if logged-in user is admin
function isAdmin(req,res,next){
    if(!req.session.user || req.session.user.role !== "admin"){
        return res.status(403).send("Access denied: Admins only");

    }
    next();


}

// -------------------- ADMIN DASHBOARD --------------------

router.get("/dashboard", async (req, res) => {
    try {

        const totaltickets = await pool.query(
            `select count(*) from tickets`
        );

        const overdueTickets = await pool.query(
            `select count(*)
             from tickets t
             join complaints c on c.id=t.complaint_id
             where t.ticket_deadline<now()
             and c.status !='Resolved'`
        );

        const activeTickets = await pool.query(`
            SELECT COUNT(*)
            FROM tickets t
            JOIN complaints c ON c.id = t.complaint_id
            WHERE c.status != 'Resolved'
        `);

        const activeNormalComplaints = await pool.query(`
            SELECT COUNT(*)
            FROM complaints
            WHERE is_ticket = false
            AND status != 'Resolved'
        `);

        // 🔴 ACTIVE TICKETS
        const activeTicketsQuery = await pool.query(`
  SELECT 
    c.*,u.public_id, 
    t.student_name,
    t.student_class,
    t.contact_email,
    t.contact_number,
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
  WHERE c.is_ticket = true AND c.status != 'Resolved'
  GROUP BY c.id,u.public_id, t.student_name, t.student_class,
           t.contact_email, t.contact_number,
           t.ticket_deadline
  ORDER BY c.priority_score DESC,
         t.ticket_deadline DESC
`);


        // 🟢 RESOLVED TICKETS
        const resolvedTicketsQuery = await pool.query(`
            SELECT c.*, 
                   t.student_name, 
                   t.student_class,
                   t.contact_email, 
                   t.contact_number,
                   t.ticket_deadline,
                   EXTRACT(EPOCH FROM (c.resolved_at - c.created_at))/3600 
                   AS resolution_hours
            FROM complaints c
            JOIN tickets t ON c.id = t.complaint_id
            WHERE c.status = 'Resolved'
            ORDER BY c.created_at DESC
        `);

        // 🟢 NORMAL COMPLAINTS
        // 🟢 NORMAL COMPLAINTS (WITH PROOFS)
const complaintsResult = await pool.query(`
  SELECT 
    c.*,u.public_id,
    json_agg(
      json_build_object(
        'file_path', p.file_path,
        'file_type', p.file_type
      )
    ) FILTER (WHERE p.id IS NOT NULL) AS proofs
  FROM complaints c
JOIN users u ON c.user_id = u.id
LEFT JOIN complaint_proofs p
  ON c.id = p.complaint_id
  WHERE c.is_ticket = false
  GROUP BY c.id,u.public_id
  ORDER BY c.priority_score DESC
`);

        const avgResolution = await pool.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) 
            AS avg_hours
            FROM complaints
            WHERE resolved_at IS NOT NULL
        `);

        const slaCompliance = await pool.query(`
            SELECT 
            COUNT(*) FILTER (
                WHERE resolved_at - created_at <= INTERVAL '48 hours'
            ) * 100.0 / NULLIF(COUNT(*),0) AS sla_percentage
            FROM complaints
            WHERE resolved_at IS NOT NULL
        `);

        const overdueRate = await pool.query(`
            SELECT 
            COUNT(*) FILTER (
                WHERE ticket_deadline < NOW()
                AND status != 'Resolved'
            ) * 100.0 / NULLIF(COUNT(*),0) AS overdue_percentage
            FROM tickets t
            JOIN complaints c ON c.id = t.complaint_id
        `);
 for (let ticket of activeTicketsQuery.rows) {

  const isOverdue = new Date(ticket.ticket_deadline) < new Date();

  const proofCount = ticket.proofs ? ticket.proofs.length : 0;

  const newPriority = calculateComplaintPriority({
    ...ticket,
    proof_count: proofCount,
    is_overdue: isOverdue
  });

  ticket.priority_score = newPriority;
}



        res.render("complaints", {
            title: "Admin Dashboard",
            activeTicketsList: activeTicketsQuery.rows,
            resolvedTicketsList: resolvedTicketsQuery.rows,
            complaints: complaintsResult.rows,

            totalTickets: totaltickets.rows[0].count,
            overdueTickets: overdueTickets.rows[0].count,
            activeTickets: activeTickets.rows[0].count,
            activeNormalComplaints: activeNormalComplaints.rows[0].count,
            avgResolution: avgResolution.rows[0].avg_hours,
            slaCompliance: slaCompliance.rows[0].sla_percentage,
            overdueRate: overdueRate.rows[0].overdue_percentage
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading complaints");
    }
});
router.post("/complaints/:id/status",isloggedin,isAdmin,async(req,res)=>{
    const complaintId=req.params.id;//selects the id from full url
    const {status}=req.body;

    try{
        if (status === "Resolved") {
    await pool.query(
        `UPDATE complaints 
         SET status=$1, resolved_at=NOW()
         WHERE id=$2`,
        [status, complaintId]
    );
    } else {
        await pool.query(
            `UPDATE complaints 
             SET status=$1 
             WHERE id=$2`,
            [status, complaintId]
        );
    }

        res.redirect("/admin/dashboard");
    }catch(err){
        console.error(err);
        res.status(500).send("Error in updation");
    }
});

// 🟢 RESOLVED NORMAL COMPLAINTS
router.get("/complaints/resolved", isloggedin, isAdmin, async (req, res) => {
  try {
    const resolvedComplaints = await pool.query(`
      SELECT *,
      EXTRACT(EPOCH FROM (resolved_at - created_at))/3600
      AS resolution_hours
      FROM complaints
      WHERE is_ticket = false
      AND status = 'Resolved'
      ORDER BY resolved_at DESC
    `);

    res.render("admin_resolved_complaints", {
      complaints: resolvedComplaints.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading resolved complaints");
  }
});
// 🟢 RESOLVED TICKETS PAGE
router.get("/tickets/resolved", isloggedin, isAdmin, async (req, res) => {
  try {

    const resolvedTickets = await pool.query(`
      SELECT c.*, 
             t.student_name,
             t.student_class,
             t.contact_email,
             t.contact_number,
             t.ticket_deadline,
             ROUND(
  EXTRACT(EPOCH FROM (c.resolved_at - c.created_at))/3600, 2
) AS resolution_hours
      FROM complaints c
      JOIN tickets t ON c.id = t.complaint_id
      WHERE c.status = 'Resolved'
      ORDER BY c.resolved_at DESC
    `);

    res.render("admin_resolved_tickets", {
      tickets: resolvedTickets.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading resolved tickets");
  }
});

module.exports = router;