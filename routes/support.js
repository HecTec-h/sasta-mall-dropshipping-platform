
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../database-postgres");
const { requireAdmin } = require("../middleware/admin-auth");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "private-support-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

// =========================================
// CUSTOMER AUTHENTICATION
// =========================================

async function requireCustomer(req, res, next) {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({
                success: false,
                error: "Please sign in to use customer support."
            });
        }

        const result = await db.query(`
            SELECT id, username, name
            FROM users
            WHERE id = $1
        `, [req.session.userId]);

        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({
                success: false,
                error: "Customer session is no longer valid."
            });
        }

        req.supportUser = user;
        next();

    } catch (error) {
        console.error("Support customer authentication error:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not verify customer session."
        });
    }
}

// =========================================
// IMAGE UPLOAD CONFIGURATION
// =========================================

const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1
    },
    fileFilter(req, file, cb) {
        if (![
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif"
        ].includes(file.mimetype)) {
            return cb(
                new Error("Attach a JPG, PNG, WEBP, or GIF image (max 5 MB).")
            );
        }

        cb(null, true);
    }
});

// =========================================
// IMAGE VALIDATION
// =========================================

function detectImage(buffer) {
    if (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) {
        return "image/jpeg";
    }

    if (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        )
    ) {
        return "image/png";
    }

    if (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
        return "image/webp";
    }

    if (
        buffer.length >= 6 &&
        ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))
    ) {
        return "image/gif";
    }

    return null;
}

// =========================================
// CONVERSATION HELPERS
// =========================================

async function getOrCreateConversation(userId) {
    await db.query(`
        INSERT INTO support_conversations (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
    `, [userId]);

    const result = await db.query(`
        SELECT *
        FROM support_conversations
        WHERE user_id = $1
    `, [userId]);

    return result.rows[0];
}

function serializeMessage(row) {
    return {
        id: row.id,
        senderType: row.sender_type,
        senderId: row.sender_id,
        body: row.body,

        attachment: row.attachment_key
            ? {
                url: `/api/support/attachments/${encodeURIComponent(row.attachment_key)}`,
                name: row.attachment_name,
                mime: row.attachment_mime,
                size: row.attachment_size
            }
            : null,

        createdAt: row.created_at
    };
}

const messageSelect = `
    SELECT
        id,
        sender_type,
        sender_id,
        body,
        attachment_name,
        attachment_key,
        attachment_mime,
        attachment_size,
        created_at
    FROM support_messages
`;

// PostgreSQL BIGINT values may be returned as strings.
function getMessageTimestamp(row) {
    if (!row) return 0;

    const storedTime = Number(row.sent_at_ms);

    if (Number.isFinite(storedTime) && storedTime > 0) {
        return storedTime;
    }

    return new Date(row.created_at).getTime() || 0;
}

// =========================================
// CUSTOMER: GET OWN CONVERSATION
// =========================================

router.get("/me", requireCustomer, async (req, res) => {
    try {
        const conversation = await getOrCreateConversation(
            req.supportUser.id
        );

        const messagesResult = await db.query(`
            ${messageSelect}
            WHERE conversation_id = $1
            ORDER BY id ASC
            LIMIT 300
        `, [conversation.id]);

        const unreadResult = await db.query(`
            SELECT
                COALESCE(MAX(id), 0) AS "latestAdminId",
                COUNT(*)::INTEGER AS "unreadCount"
            FROM support_messages
            WHERE conversation_id = $1
              AND sender_type = 'admin'
              AND id > COALESCE((
                  SELECT user_last_read_message_id
                  FROM support_conversations
                  WHERE id = $1
              ), 0)
        `, [conversation.id]);

        const unreadRow = unreadResult.rows[0];

        const markRead = ["1", "true"].includes(
            String(req.query.markRead || "").toLowerCase()
        );

        let unreadCount = Number(unreadRow.unreadCount || 0);

        if (markRead) {
            await db.query(`
                UPDATE support_conversations
                SET
                    user_last_read_at = CURRENT_TIMESTAMP,
                    user_last_read_message_id = $1
                WHERE id = $2
            `, [
                unreadRow.latestAdminId,
                conversation.id
            ]);

            unreadCount = 0;
        }

        const lastResult = await db.query(`
            SELECT sent_at_ms, created_at
            FROM support_messages
            WHERE conversation_id = $1
              AND sender_type = 'customer'
            ORDER BY id DESC
            LIMIT 1
        `, [conversation.id]);

        const lastSentAt = getMessageTimestamp(lastResult.rows[0]);

        const cooldownRemainingMs = lastSentAt
            ? Math.max(0, 15000 - (Date.now() - lastSentAt))
            : 0;

        res.json({
            success: true,

            conversation: {
                id: conversation.id,
                status: conversation.status,
                updatedAt: conversation.updated_at
            },

            messages: messagesResult.rows.map(serializeMessage),
            cooldownRemainingMs,
            unreadCount
        });

    } catch (error) {
        console.error("Support conversation error:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not load customer support."
        });
    }
});

// =========================================
// CUSTOMER: SEND MESSAGE
// =========================================

router.post("/messages", requireCustomer, (req, res) => {
    upload.single("screenshot")(req, res, async (uploadError) => {
        if (uploadError) {
            return res.status(400).json({
                success: false,
                error: uploadError.message || "Could not upload screenshot."
            });
        }

        let client;
        let transactionStarted = false;
        let savedFilePath = null;

        try {
            const body = String(req.body.message || "").trim();

            if (body.length > 2000) {
                return res.status(400).json({
                    success: false,
                    error: "Messages must be 2,000 characters or fewer."
                });
            }

            if (!body && !req.file) {
                return res.status(400).json({
                    success: false,
                    error: "Write a message or attach a screenshot."
                });
            }

            if (
                req.file &&
                detectImage(req.file.buffer) !== req.file.mimetype
            ) {
                return res.status(400).json({
                    success: false,
                    error: "The attachment is not a valid supported image."
                });
            }

            client = await db.connect();

            await client.query("BEGIN");
            transactionStarted = true;

            await client.query(`
                INSERT INTO support_conversations (user_id)
                VALUES ($1)
                ON CONFLICT (user_id) DO NOTHING
            `, [req.supportUser.id]);

            const conversationResult = await client.query(`
                SELECT *
                FROM support_conversations
                WHERE user_id = $1
                FOR UPDATE
            `, [req.supportUser.id]);

            const conversation = conversationResult.rows[0];

            const lastResult = await client.query(`
                SELECT sent_at_ms, created_at
                FROM support_messages
                WHERE conversation_id = $1
                  AND sender_type = 'customer'
                ORDER BY id DESC
                LIMIT 1
            `, [conversation.id]);

            const last = lastResult.rows[0];

            if (last) {
                const lastTime = getMessageTimestamp(last);
                const remaining = 15000 - (Date.now() - lastTime);

                if (remaining > 0) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;

                    return res.status(429).json({
                        success: false,
                        error: "Please wait before sending another message.",
                        retryAfterMs: remaining
                    });
                }
            }

            let key = null;
            let attachmentName = null;
            let attachmentMime = null;
            let attachmentSize = null;

            if (req.file) {
                const randomKey = crypto.randomBytes(24).toString("hex");

                const ext = {
                    "image/jpeg": ".jpg",
                    "image/png": ".png",
                    "image/webp": ".webp",
                    "image/gif": ".gif"
                }[req.file.mimetype];

                key = randomKey + ext;

                savedFilePath = path.join(uploadDir, key);

                fs.writeFileSync(
                    savedFilePath,
                    req.file.buffer,
                    {
                        flag: "wx",
                        mode: 0o600
                    }
                );

                attachmentName = path.basename(
                    req.file.originalname || "screenshot"
                ).slice(0, 160);

                attachmentMime = req.file.mimetype;
                attachmentSize = req.file.size;
            }

            const insertResult = await client.query(`
                INSERT INTO support_messages (
                    conversation_id,
                    sender_type,
                    sender_id,
                    body,
                    attachment_name,
                    attachment_key,
                    attachment_mime,
                    attachment_size,
                    sent_at_ms
                )
                VALUES ($1, 'customer', $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `, [
                conversation.id,
                req.supportUser.id,
                body,
                attachmentName,
                key,
                attachmentMime,
                attachmentSize,
                Date.now()
            ]);

            await client.query(`
                UPDATE support_conversations
                SET
                    status = 'open',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [conversation.id]);

            const messageResult = await client.query(`
                ${messageSelect}
                WHERE id = $1
            `, [insertResult.rows[0].id]);

            await client.query("COMMIT");
            transactionStarted = false;

            res.status(201).json({
                success: true,
                message: serializeMessage(messageResult.rows[0]),
                cooldownMs: 15000
            });

        } catch (error) {
            if (client && transactionStarted) {
                await client.query("ROLLBACK").catch(() => {});
            }

            if (savedFilePath && fs.existsSync(savedFilePath)) {
                fs.unlinkSync(savedFilePath);
            }

            console.error("Support message error:", error);

            res.status(500).json({
                success: false,
                error: "Could not send message."
            });

        } finally {
            if (client) {
                client.release();
            }
        }
    });
});

// =========================================
// PRIVATE ATTACHMENT ACCESS
// =========================================

router.get("/attachments/:key", async (req, res) => {
    try {
        const key = String(req.params.key || "");

        const result = await db.query(`
            SELECT
                m.attachment_key,
                m.attachment_mime,
                m.attachment_name,
                m.conversation_id,
                c.user_id
            FROM support_messages m
            JOIN support_conversations c
                ON c.id = m.conversation_id
            WHERE m.attachment_key = $1
        `, [key]);

        const row = result.rows[0];

        if (!row) {
            return res.sendStatus(404);
        }

        const isAdmin = !!(req.session && req.session.adminId);

        const isOwner = !!(
            req.session &&
            req.session.userId &&
            Number(req.session.userId) === Number(row.user_id)
        );

        if (!isAdmin && !isOwner) {
            return res.sendStatus(403);
        }

        const filePath = path.join(uploadDir, row.attachment_key);

        if (!fs.existsSync(filePath)) {
            return res.sendStatus(404);
        }

        res.set({
            "Content-Type": row.attachment_mime,

            "Content-Disposition": `inline; filename="${path.basename(
                row.attachment_name || "screenshot"
            ).replace(/["\r\n]/g, "_")}"`,

            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store"
        });

        res.sendFile(filePath);

    } catch (error) {
        console.error("Support attachment error:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not load attachment."
        });
    }
});

// =========================================
// ADMIN: CONVERSATION LIST
// =========================================

router.get("/admin/conversations", requireAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                c.id,
                c.user_id,
                c.status,
                c.created_at,
                c.updated_at,
                u.name AS user_name,
                u.username,

                (
                    SELECT body
                    FROM support_messages m
                    WHERE m.conversation_id = c.id
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS last_message,

                (
                    SELECT attachment_key
                    FROM support_messages m
                    WHERE m.conversation_id = c.id
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS last_attachment,

                (
                    SELECT created_at
                    FROM support_messages m
                    WHERE m.conversation_id = c.id
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS last_message_at,

                (
                    SELECT COUNT(*)::INTEGER
                    FROM support_messages m
                    WHERE m.conversation_id = c.id
                      AND m.sender_type = 'customer'
                      AND m.id > COALESCE(c.admin_last_read_message_id, 0)
                ) AS unread_count

            FROM support_conversations c
            JOIN users u ON u.id = c.user_id

            ORDER BY
                COALESCE(
    (
        SELECT created_at
        FROM support_messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.id DESC
        LIMIT 1
    ),
    c.updated_at
) DESC,
                c.id DESC
        `);

        const conversations = result.rows.map(row => ({
            ...row,
            last_message:
                row.last_message ||
                (row.last_attachment ? "📷 Screenshot" : "No messages yet")
        }));

        res.json({
            success: true,
            conversations
        });

    } catch (error) {
        console.error("Admin support conversations error:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not load conversations."
        });
    }
});

// =========================================
// ADMIN: GET CONVERSATION MESSAGES
// =========================================

router.get("/admin/conversations/:id/messages", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                error: "Invalid conversation."
            });
        }

        const conversationResult = await db.query(`
            SELECT id, user_id, status
            FROM support_conversations
            WHERE id = $1
        `, [id]);

        const conversation = conversationResult.rows[0];

        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: "Conversation not found."
            });
        }

        const latestResult = await db.query(`
            SELECT COALESCE(MAX(id), 0) AS id
            FROM support_messages
            WHERE conversation_id = $1
              AND sender_type = 'customer'
        `, [id]);

        await db.query(`
            UPDATE support_conversations
            SET
                admin_last_read_at = CURRENT_TIMESTAMP,
                admin_last_read_message_id = $1
            WHERE id = $2
        `, [
            latestResult.rows[0].id,
            id
        ]);

        const messagesResult = await db.query(`
            ${messageSelect}
            WHERE conversation_id = $1
            ORDER BY id ASC
            LIMIT 500
        `, [id]);

        res.json({
            success: true,
            conversation,
            messages: messagesResult.rows.map(serializeMessage)
        });

    } catch (error) {
        console.error("Admin support messages error:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not load conversation messages."
        });
    }
});

// =========================================
// ADMIN: SEND REPLY
// =========================================

router.post("/admin/conversations/:id/messages", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const body = String(req.body.message || "").trim();

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                error: "Invalid conversation."
            });
        }

        const conversationResult = await db.query(`
            SELECT id
            FROM support_conversations
            WHERE id = $1
        `, [id]);

        if (!conversationResult.rows[0]) {
            return res.status(404).json({
                success: false,
                error: "Conversation not found."
            });
        }

        if (!body) {
            return res.status(400).json({
                success: false,
                error: "Write a reply first."
            });
        }

        if (body.length > 2000) {
            return res.status(400).json({
                success: false,
                error: "Messages must be 2,000 characters or fewer."
            });
        }

        const insertResult = await db.query(`
            INSERT INTO support_messages (
                conversation_id,
                sender_type,
                sender_id,
                body
            )
            VALUES ($1, 'admin', $2, $3)
            RETURNING id
        `, [
            id,
            req.session.adminId,
            body
        ]);

        await db.query(`
            UPDATE support_conversations
            SET
                updated_at = CURRENT_TIMESTAMP,
                status = 'open'
            WHERE id = $1
        `, [id]);

        const messageResult = await db.query(`
            ${messageSelect}
            WHERE id = $1
        `, [insertResult.rows[0].id]);

        res.status(201).json({
            success: true,
            message: serializeMessage(messageResult.rows[0])
        });

    } catch (error) {
        console.error("Admin support reply error:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not send reply."
        });
    }
});

// =========================================
// ADMIN: MARK CONVERSATION AS READ
// =========================================

router.post("/admin/conversations/:id/read", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                error: "Invalid conversation."
            });
        }

        const latestResult = await db.query(`
            SELECT COALESCE(MAX(id), 0) AS id
            FROM support_messages
            WHERE conversation_id = $1
              AND sender_type = 'customer'
        `, [id]);

        const result = await db.query(`
            UPDATE support_conversations
            SET
                admin_last_read_at = CURRENT_TIMESTAMP,
                admin_last_read_message_id = $1
            WHERE id = $2
        `, [
            latestResult.rows[0].id,
            id
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: "Conversation not found."
            });
        }

        res.json({ success: true });

    } catch (error) {
        console.error("Mark support conversation read error:", error.message);

        res.status(500).json({
            success: false,
            error: "Could not mark conversation as read."
        });
    }
});

module.exports = router;
