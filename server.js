require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const expressLayouts = require("express-ejs-layouts");
const { nanoid } = require("nanoid");

const app = express();

// Database
const pool = require("./db");

// Routes
const adminRoutes = require("./routes/admin");
const studentRoutes = require("./routes/student");

// Utility
const calculateComplaintPriority = require("./utils/priorityEngine");


// -------------------- BASIC APP SETUP --------------------

app.set("view engine", "ejs");

app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));


// -------------------- SESSION CONFIG --------------------

app.use(
  session({
    secret: process.env.SESSION_SECRET || "campify_secret",
    resave: false,
    saveUninitialized: false,
  })
);


// -------------------- AUTH MIDDLEWARE --------------------

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

function isloggedin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).send("You must be logged in");
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


// -------------------- ROUTES --------------------

app.use("/admin", adminRoutes);
app.use("/student", studentRoutes);


// -------------------- DEBUG SESSION ROUTES --------------------

app.get("/test-session", (req, res) => {
  req.session.test = "Session is working";
  res.send("Session set");
});

app.get("/check-session", (req, res) => {
  res.send(req.session.test || "No session found");
});


// -------------------- HOME ROUTE --------------------

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


// -------------------- LOGIN / SIGNUP PAGES --------------------

app.get("/login", (req, res) => {
  res.render("login", {
    layout: "auth_layout",
    title: "Login",
  });
});

app.get("/signup", (req, res) => {
  res.render("signup", {
    layout: "auth_layout",
    title: "Signup",
  });
});


// -------------------- USER SIGNUP --------------------

app.post("/signup", async (req, res) => {

  const { name, email, password } = req.body;

  try {

    const publicId = "u_" + nanoid(8);

    const hashed_password = await bcrypt.hash(password, 10);

    await pool.query(
      `
      INSERT INTO users 
      (name, email, password_hash, role, public_id)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [name, email, hashed_password, "student", publicId]
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


// -------------------- USER LOGIN --------------------

app.post("/login", async (req, res) => {

  const { email, password } = req.body;

  try {

    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).send("Invalid Email or Password");
    }

    const user = result.rows[0];

    const ismatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!ismatch) {
      return res.status(401).send("Invalid Email or Password");
    }

    req.session.user = {
      id: user.id,
      role: user.role,
      name: user.name,
      public_id: user.public_id,
    };

    if (user.role === "admin") {
      return res.redirect("/admin/dashboard");
    }

    if (user.role === "student") {
      return res.redirect("/student/dashboard");
    }

    if (user.role === "staff") {
      return res.redirect("/staff/dashboard");
    }

  } catch (err) {

    console.error(err);

    res.status(500).send("Error during login");
  }
});


// -------------------- LOGOUT --------------------

app.get("/logout", (req, res) => {

  req.session.destroy(() => {
    res.redirect("/login");
  });

});


// -------------------- DEBUG ROUTE --------------------

app.get("/whoami", (req, res) => {
  res.json(req.session.user || "Not logged in");
});

app.get("/health", (req, res) => {
  res.send("Campify Railway Working");
});
// -------------------- SERVER START --------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});