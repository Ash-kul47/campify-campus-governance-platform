// Load environment variables from .env file (DB credentials, secrets, etc.)

require("dotenv").config();//reads the .env file to get db data
console.log("SERVER ENV CHECK:", process.env.DB_USER);

// Initialize database connection (pg Pool
require("./db");
const expressLayouts = require("express-ejs-layouts");
//import priority engine.js
const calculateComplaintPriority=require("./utils/priorityEngine");


const adminRoutes = require("./routes/admin");
const studentRoutes = require("./routes/student");

// Import required packages
const session = require("express-session");
const bcrypt=require("bcrypt");
const express=require("express");
const app=express();
const { nanoid } = require("nanoid");


// -------------------- BASIC APP SETUP --------------------

// Set EJS as the template engine
app.set("view engine","ejs");
app.use(expressLayouts);
app.set("layout", "layout");

// Parse form data (req.body)
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(express.static("public"));

//proof 
app.use("/uploads", express.static("uploads"));



// -------------------- SESSION CONFIG --------------------
// This enables authentication using sessions & cookies
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);


//----------------AUTH MIDDLEWARE-----------------//
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

//checks if user is logged in
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

function isStudent(req, res, next) {
  if (!req.session.user || req.session.user.role !== "student") {
    return res.status(403).send("Access denied: Students only");
  }
  next();
}

app.use("/admin", adminRoutes);
app.use("/student", studentRoutes);


// -------------------- SESSION TEST ROUTES (DEBUG ONLY) --------------------

// Sets a test value in session to verify sessions work
app.get("/test-session", (req, res) => {
  req.session.test = "Session is working";
  res.send("Session set");
});

// Reads session value to confirm persistence
app.get("/check-session", (req, res) => {
  res.send(req.session.test || "No session found");
});

// -------------------- PUBLIC ROUTES --------------------

// Home page
app.get("/", (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === "admin") {
      return res.redirect("/admin/dashboard");
    }
    if (req.session.user.role === "student") {
      return res.redirect("/student/dashboard");
    }
  }

  return res.redirect("/login");
});
//ticket route


// Signup page
app.get("/login",(req,res)=>{
    res.render("login", {
  layout: "auth_layout",
  title: "Login"
});
});


// Login page
app.get("/signup", (req, res) => {
  res.render("signup", {
  layout: "auth_layout",
  title: "Signup"
});
});

app.get("/", (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === "admin") {
      return res.redirect("/admin/dashboard");
    }
    if (req.session.user.role === "student") {
      return res.redirect("/student/dashboard");
    }
  }

  res.redirect("/login");
});

const pool = require("./db");

// -------------------- COMPLAINT CREATION --------------------
// Handles complaint submission (anonymous for now)




// -------------------- ADMIN: UPDATE COMPLAINT STATUS --------------------
// Admin updates status (Pending / In Progress / Resolved)



// -------------------- UPVOTING A COMPLAINT --------------------
// Increments upvote count (auth restriction will come later)


// -------------------- USER SIGNUP --------------------
// Registers a new student user
app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const publicId = "u_" + nanoid(8);
    const hashed_password = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (name,email,password_hash,role,public_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [name, email, hashed_password, "student",publicId]
    );

    res.redirect("/login");

  } catch (err) {

    if (err.code === "23505") {
      return res.send("Email already registered. Please login.");
    }

    console.error(err);
    res.status(500).send("Error during signup");
  }
});

// -------------------- USER LOGIN (AUTHENTICATION) --------------------
// Authenticates user and creates session
//login route this will authenticate
app.post("/login",async(req,res)=>{
    const {email,password}=req.body;

    try{
        const result=await pool.query(
            `select * from users where email=$1`,
            [email]
        );
        if(result.rows.length===0){
            return res.status(401).send("Invalid Email or Password");
        }

        const user=result.rows[0];

        //complare password

        const ismatch=await bcrypt.compare(password,user.password_hash);

        if (!ismatch) {
            return res.status(401).send("Invalid email or password");
        }

        //session creation
        req.session.user={
            id:user.id,
            role:user.role,
            name:user.name,
            public_id: user.public_id
        };
        if(user.role==="admin"){
            return res.redirect("/admin/dashboard");
        }
        if(user.role==="student"){
            return res.redirect("/student/dashboard");
        }
        if(user.role==="staff"){
            return res.redirect("/staff/dashboard");
        }
        }catch(err){
        console.error(err);
        res.status(500).send("Error during login");
    }
});





app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});





// -------------------- DEBUG ROUTE --------------------
// Shows currently logged-in user (session check)
app.get("/whoami", (req, res) => {
  res.json(req.session.user || "Not logged in");
});


const port=3000;
app.listen(port,function(){
    console.log("server is running on http://localhost:3000");
});