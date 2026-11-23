
const express = require("express");
const bcrypt = require("bcrypt");

const db = require("../database-postgres");

const router = express.Router();

// ADMIN LOGIN
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required."
            });
        }

        const result = await db.query(`
            SELECT
                id,
                username,
                password_hash,
                name,
                active
            FROM admins
            WHERE username = $1
        `, [username]);

        const admin = result.rows[0];

        if (!admin || Number(admin.active) !== 1) {
            return res.status(401).json({
                success: false,
                message: "Invalid admin credentials."
            });
        }

        const passwordMatch = await bcrypt.compare(
            password,
            admin.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid admin credentials."
            });
        }

        req.session.adminId = admin.id;
        req.session.adminUsername = admin.username;

        return res.json({
            success: true,
            message: "Admin login successful.",
            admin: {
                id: admin.id,
                username: admin.username,
                name: admin.name
            }
        });

    } catch (error) {
        console.error("Admin login error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Server error."
        });
    }
});

// ADMIN LOGOUT
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({
            success: true
        });
    }

    req.session.adminId = null;
    req.session.adminUsername = null;

    req.session.save((error) => {
        if (error) {
            return res.status(500).json({
                success: false,
                message: "Could not logout."
            });
        }

        res.json({
            success: true,
            message: "Admin logged out."
        });
    });
});

// CHECK ADMIN LOGIN
router.get("/me", async (req, res) => {
    try {
        if (!req.session || !req.session.adminId) {
            return res.json({
                loggedIn: false
            });
        }

        const result = await db.query(`
            SELECT
                id,
                username,
                name
            FROM admins
            WHERE id = $1
              AND active = 1
        `, [req.session.adminId]);

        const admin = result.rows[0];

        if (!admin) {
            req.session.adminId = null;
            req.session.adminUsername = null;

            return res.json({
                loggedIn: false
            });
        }

        return res.json({
            loggedIn: true,
            admin
        });

    } catch (error) {
        console.error("Admin session check failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Server error."
        });
    }
});

module.exports = router;
