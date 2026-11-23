const db = require("./database");
const bcrypt = require("bcrypt");

const username = "admin";
const password = "phat123123";
const name = "Sasta-mall Admin";

async function createAdmin() {
    try {
        const existingAdmin = db
            .prepare("SELECT id FROM admins WHERE username = ?")
            .get(username);

        if (existingAdmin) {
            console.log("Admin username already exists.");
            db.close();
            return;
        }

        const passwordHash = await bcrypt.hash(password, 12);

        db.prepare(`
            INSERT INTO admins (
                username,
                password_hash,
                name
            )
            VALUES (?, ?, ?)
        `).run(
            username,
            passwordHash,
            name
        );

        console.log("Admin account created successfully.");
        console.log("Username:", username);
        console.log("Password:", password);

        db.close();

    } catch (error) {
        console.error("Failed to create admin:");
        console.error(error.message);
        db.close();
    }
}

createAdmin();