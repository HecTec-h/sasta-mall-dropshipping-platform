
const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../database-postgres");

const router = express.Router();

// SIGN UP
router.post("/signup", async (req, res) => {
    try {
        const { username, password, name, phone } = req.body;

        if (!username || !password || !name || !phone) {
            return res.status(400).json({
                success: false,
                error: "All fields are required."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: "Password must be at least 6 characters."
            });
        }

        const existingUser = await db.query(`
            SELECT id
            FROM users
            WHERE username = $1
        `, [username]);

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: "Username already exists."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await db.query(`
            INSERT INTO users (
                username,
                password_hash,
                name,
                phone
            )
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `, [username, passwordHash, name, phone]);

        req.session.userId = result.rows[0].id;

        res.json({
            success: true,
            message: "Account created successfully."
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                error: "Username already exists."
            });
        }

        console.error("Signup failed:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not create account."
        });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: "Username and password are required."
            });
        }

        const result = await db.query(`
            SELECT *
            FROM users
            WHERE username = $1
        `, [username]);

        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({
                success: false,
                error: "Invalid username or password."
            });
        }

        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: "Invalid username or password."
            });
        }

        req.session.userId = user.id;

        res.json({
            success: true,
            message: "Login successful."
        });

    } catch (error) {
        console.error("Login failed:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not login."
        });
    }
});

// LOGOUT
router.post("/logout", (req, res) => {
    req.session.destroy(error => {
        if (error) {
            return res.status(500).json({
                success: false,
                error: "Could not logout."
            });
        }

        res.json({
            success: true,
            message: "Logged out successfully."
        });
    });
});

// CURRENT USER
router.get("/me", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({
                loggedIn: false
            });
        }

        const result = await db.query(`
            SELECT id, username, name, phone
            FROM users
            WHERE id = $1
        `, [req.session.userId]);

        const user = result.rows[0];

        if (!user) {
            return res.json({
                loggedIn: false
            });
        }

        res.json({
            loggedIn: true,
            user
        });

    } catch (error) {
        console.error("Current user lookup failed:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not load current user."
        });
    }
});

module.exports = router;
