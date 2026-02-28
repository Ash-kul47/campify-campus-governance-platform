const express = require("express");
const router = express.Router();
const pool = require("../db");
const upload = require("../utils/upload");

const calculateComplaintPriority=require("../utils/priorityEngine");

function isloggedin(req,res,next){
    if(!req.session.user){
        return res.status(401).send("You must be logged in ")
    }
    next();//allows request to continue
}
function isAdmin(req,res,next){
    if(!req.session.user || req.session.user.role !== "admin"){
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
// student routes go here
//student dashboard
router.get("/dashboard",isloggedin,isStudent,async(req,res)=>{
    try{
        const complaintsResults = await pool.query(`
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
WHERE c.user_id = $1
  AND c.is_ticket = false
GROUP BY c.id, u.public_id
  ORDER BY c.created_at DESC
`, [req.session.user.id]);

        // 2. All complaints (for upvoting)
    const allComplaints = await pool.query(`
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
  ORDER BY c.created_at DESC
`);
    const mytickets = await pool.query(`
  SELECT 
    c.*,u.public_id,
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
LEFT JOIN complaint_proofs p
    ON c.id = p.complaint_id
  WHERE c.user_id = $1
  GROUP BY c.id,u.public_id,t.ticket_deadline
  ORDER BY c.created_at DESC
`, [req.session.user.id]);

    
    res.render("student_dashboard",{
        user:req.session.user,
        complaints:complaintsResults.rows,
        allComplaints:allComplaints.rows,
        myTickets: mytickets.rows
    });
    }catch(err){
        console.error(err);
        res.status(500).send("Error loading student dashboard")
    }
});
router.get("/ticket/new", isloggedin, isStudent, (req, res) => {
  res.render("ticket_form");
});

router.post("/ticket",isloggedin,isStudent,upload.single("proof"),async(req,res)=>{
    const{title,description,category,location,student_name,student_class,contact_email,contact_number}=req.body;
    const user_id=req.session.user.id;

    try{
        // Check if user already has active ticket
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

        const complaint_result=await pool.query(
            `insert into complaints(title,description,category,location,user_id,is_ticket)
            values($1,$2,$3,$4,$5,true)
            returning id`,
            [title,description,category,location,user_id]
        );

        const deadline_result=await pool.query(
            `select now() + interval '48 hours' as deadline`

        );
        const ticket_deadline=deadline_result.rows[0].deadline;
        const complaint_id = complaint_result.rows[0].id;

        // If proof uploaded
if (req.file) {
  await pool.query(
    `INSERT INTO complaint_proofs (complaint_id, file_path, file_type)
     VALUES ($1, $2, $3)`,
    [
      complaint_id,
      req.file.path,
      req.file.mimetype
    ]
  );
}

        await pool.query(
            `insert into tickets
            (complaint_id,student_name,student_class,contact_email,contact_number,ticket_deadline)
            values ($1,$2,$3,$4,$5,$6)`,
            [complaint_id, student_name, student_class, contact_email, contact_number, ticket_deadline]
        );
        res.redirect("/student/dashboard");
        

    } catch (err) {
        console.error(err);
        res.status(500).send("Error creating ticket");
  }
});



// Complaint form page (will be protected later)
router.get("/complaint/new",isloggedin,isStudent,function(req,res){
    res.render("complaint_form");
});

router.post("/complaint",isloggedin,isStudent,upload.single("proof"),async(req,res)=>{
    const {title,description,category,location}=req.body;
    const user_id=req.session.user.id;

    try{
        const result=await pool.query(
            `insert into complaints(title,description,category,location,user_id)
            values ($1,$2,$3,$4,$5)
            returning *`,
            [title,description,category,location,user_id]
        );
        const complaint=result.rows[0];

        // If proof uploaded
if (req.file) {
        await pool.query(
          `INSERT INTO complaint_proofs
           (complaint_id, file_path, file_type)
           VALUES ($1, $2, $3)`,
          [complaint.id, req.file.path, req.file.mimetype]
        );
      }

        // 3️⃣ NOW RECALCULATE PRIORITY (THIS IS STEP 3)

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

      // 4️⃣ Redirect
      res.redirect("/student/dashboard");

    }catch(err){
        console.error(err);
        res.status(500).send("Error submitting complaint");
    }
});

router.post("/complaints/:id/upvote",isloggedin,isStudent,async(req,res)=>{
    const complaintId=req.params.id;
    const userId=req.session.user.id;
    try{

        //try inserting vote
        await pool.query(
            `insert into complaint_votes (complaint_id,user_id)
            values ($1,$2)`,
            [complaintId,userId]
        );
        //if successfull count+1
        await pool.query(
            "update complaints set upvotes=upvotes+1 where id=$1",
            [complaintId]
        );
        // fetch updated complaint
        const updatedComplaint = await pool.query(
            "select * from complaints where id = $1",
            [complaintId]
        );

        const complaint = updatedComplaint.rows[0];

        // recalculate priority
const newPriority = calculateComplaintPriority(complaint);

        await pool.query(
    "update complaints set priority_score = $1 where id = $2",
    [newPriority, complaintId]
);
        res.redirect("/student/dashboard");

    }catch(err){

        if(err.code=='23505'){
            return res.status(400).send("upvoted already");
        }
        console.error(err);
        res.status(500).send("Error while upvoting")
    }
});




module.exports = router;