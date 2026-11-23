
const express = require("express");
const db = require("../database-postgres");
const { requireAdmin } = require("../middleware/admin-auth");

const router = express.Router();

// =========================================
// AUTOMATIC DELIVERY TIMER
// =========================================

async function deliverExpiredShippedOrders() {
    try {
        const result = await db.query(`
            UPDATE orders
            SET
                order_status = 'delivered',
                updated_at = CURRENT_TIMESTAMP
            WHERE order_status = 'shipped'
              AND shipped_at IS NOT NULL
              AND shipped_at + INTERVAL '10 days' <= CURRENT_TIMESTAMP
        `);

        if (result.rowCount > 0) {
            console.log(
                `[Order timer] Automatically marked ${result.rowCount} order(s) as delivered.`
            );
        }
    } catch (error) {
        console.error(
            "[Order timer] Automatic delivery check failed:",
            error.message
        );
    }
}

deliverExpiredShippedOrders();

const deliveryTimer = setInterval(
    deliverExpiredShippedOrders,
    30 * 1000
);

if (typeof deliveryTimer.unref === "function") {
    deliveryTimer.unref();
}

// =========================================
// DASHBOARD STATISTICS
// =========================================

router.get("/stats", requireAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                (SELECT COUNT(*) FROM products)::INTEGER AS total_products,
                (SELECT COUNT(*) FROM users)::INTEGER AS total_customers,
                (SELECT COUNT(*) FROM orders)::INTEGER AS total_orders,

                (SELECT COUNT(*) FROM orders
                 WHERE payment_status IN ('pending', 'submitted')
                )::INTEGER AS pending_payments,

                (SELECT COUNT(*) FROM orders
                 WHERE payment_status IN ('pending', 'submitted')
                )::INTEGER AS management,

                (SELECT COUNT(*) FROM orders
                 WHERE payment_status = 'approved'
                 AND order_status = 'pending'
                )::INTEGER AS approved,

                (SELECT COUNT(*) FROM orders
                 WHERE payment_status = 'approved'
                 AND order_status = 'processing'
                )::INTEGER AS processing,

                (SELECT COUNT(*) FROM orders
                 WHERE order_status = 'shipped'
                 AND payment_status = 'approved'
                )::INTEGER AS shipped,

                (SELECT COUNT(*) FROM orders
                 WHERE payment_status = 'rejected'
                )::INTEGER AS rejected,

                (SELECT COUNT(*) FROM orders
                 WHERE order_status = 'delivered'
                 AND payment_status != 'rejected'
                )::INTEGER AS delivered
        `);

        const row = result.rows[0];

        const stats = {
            totalProducts: row.total_products,
            totalCustomers: row.total_customers,
            totalOrders: row.total_orders,
            pendingPayments: row.pending_payments,
            sectionCounts: {
                management: row.management,
                approved: row.approved,
                processing: row.processing,
                shipped: row.shipped,
                rejected: row.rejected,
                delivered: row.delivered
            }
        };

        res.json({ success: true, stats });

    } catch (error) {
        console.error("Admin stats error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load dashboard statistics."
        });
    }
});

// =========================================
// ADMIN CUSTOMERS & ORDERS
// =========================================

router.get("/customers", requireAdmin, async (req, res) => {
    try {
        const q = String(req.query.q || "").trim().slice(0, 100);
        const status = String(req.query.status || "all").toLowerCase();

        const allowedStatuses = new Set([
            "all",
            "pending",
            "processing",
            "shipped",
            "delivered",
            "cancelled"
        ]);

        if (!allowedStatuses.has(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status filter."
            });
        }

        const params = [];
        let where = "";

        if (status !== "all") {
            params.push(status);
            where += ` AND LOWER(o.order_status) = $${params.length}`;
        }

        if (q) {
            const term = `%${q.toLowerCase()}%`;
            const phoneTerm = `%${q}%`;

            params.push(term, term, term, phoneTerm);

            const start = params.length - 3;

            where += `
                AND (
                    CAST(o.id AS TEXT) ILIKE $${start}
                    OR LOWER(COALESCE(o.full_name, '')) LIKE $${start + 1}
                    OR LOWER(COALESCE(u.username, '')) LIKE $${start + 2}
                    OR COALESCE(o.phone, '') LIKE $${start + 3}
                )
            `;
        }

        const ordersResult = await db.query(`
            SELECT
                o.id,
                o.user_id,
                o.total,
                o.payment_status,
                o.order_status,
                o.full_name,
                o.phone,
                o.province,
                o.city,
                o.postal_code,
                o.address,
                o.delivery_instructions,
                o.created_at,
                u.username AS customer_username
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            WHERE 1 = 1 ${where}
            ORDER BY o.id DESC
        `, params);

        const orders = await Promise.all(
            ordersResult.rows.map(async (order) => {
                const itemsResult = await db.query(`
                    SELECT
                        id,
                        product_id,
                        product_name,
                        quantity,
                        price
                    FROM order_items
                    WHERE order_id = $1
                    ORDER BY id ASC
                `, [order.id]);

                return {
                    ...order,
                    items: itemsResult.rows
                };
            })
        );

        res.json({
            success: true,
            orders
        });

    } catch (error) {
        console.error("Admin customers/orders error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load customer orders."
        });
    }
});

// =========================================
// TRACKING WORKSPACE
// =========================================

router.get("/tracking", requireAdmin, async (req, res) => {
    try {
        const [ordersResult, entriesResult] = await Promise.all([
            db.query(`
                SELECT
                    o.id AS order_id,
                    o.user_id,
                    o.full_name,
                    o.phone,
                    o.payment_status,
                    o.order_status,
                    o.shipped_at,
                    o.created_at AS order_created_at,
                    u.username AS customer_username
                FROM orders o
                LEFT JOIN users u ON u.id = o.user_id
                WHERE o.payment_status = 'approved'
                  AND o.order_status IN ('processing', 'shipped')
                ORDER BY o.id DESC
            `),

            db.query(`
                SELECT
                    t.id AS tracking_row_id,
                    t.order_id,
                    t.product_name,
                    t.quantity,
                    t.courier_name,
                    t.tracking_number,
                    t.tracking_url,
                    t.created_at,
                    t.updated_at
                FROM order_tracking_entries t
                ORDER BY t.order_id DESC, t.id ASC
            `)
        ]);

        res.json({
            success: true,
            orders: ordersResult.rows,
            entries: entriesResult.rows
        });

    } catch (error) {
        console.error("Tracking list error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load tracking workspace."
        });
    }
});

// =========================================
// ADD TRACKING ENTRY
// =========================================

router.post("/tracking", requireAdmin, async (req, res) => {
    try {
        const orderId = Number(req.body.order_id);
        const productName = String(req.body.product_name || "").trim();
        const quantity = Number(req.body.quantity);
        const courierName = String(req.body.courier_name || "").trim();
        const trackingNumber = String(req.body.tracking_number || "").trim();
        const trackingUrl = String(req.body.tracking_url || "").trim();

        if (!Number.isSafeInteger(orderId) || orderId < 1) {
            return res.status(400).json({
                success: false,
                message: "Order select karein."
            });
        }

        if (!productName || !courierName || !trackingNumber) {
            return res.status(400).json({
                success: false,
                message: "Product name, courier company aur tracking ID fill karein."
            });
        }

        if (!Number.isSafeInteger(quantity) || quantity < 1) {
            return res.status(400).json({
                success: false,
                message: "Quantity kam az kam 1 honi chahiye."
            });
        }

        if (trackingUrl) {
            try {
                const parsed = new URL(trackingUrl);

                if (!["http:", "https:"].includes(parsed.protocol)) {
                    throw new Error("Invalid protocol");
                }
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Tracking link valid http/https URL hona chahiye."
                });
            }
        }

        const orderResult = await db.query(`
            SELECT id, payment_status, order_status
            FROM orders
            WHERE id = $1
        `, [orderId]);

        const order = orderResult.rows[0];

        if (
            !order ||
            order.payment_status !== "approved" ||
            order.order_status !== "shipped"
        ) {
            return res.status(400).json({
                success: false,
                message: "Tracking sirf Shipped order par add kar sakte hain. Pehle order ko Shipped mark karein."
            });
        }

        const result = await db.query(`
            INSERT INTO order_tracking_entries (
                order_id,
                product_name,
                quantity,
                courier_name,
                tracking_number,
                tracking_url
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `, [
            orderId,
            productName,
            quantity,
            courierName,
            trackingNumber,
            trackingUrl || null
        ]);

        res.json({
            success: true,
            message: "Tracking entry save ho gayi.",
            tracking_id: result.rows[0].id
        });

    } catch (error) {
        console.error("Tracking create error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not save tracking entry."
        });
    }
});

// =========================================
// UPDATE TRACKING ENTRY
// =========================================

router.patch("/tracking/:trackingId", requireAdmin, async (req, res) => {
    try {
        const trackingId = Number(req.params.trackingId);
        const productName = String(req.body.product_name || "").trim();
        const quantity = Number(req.body.quantity);
        const courierName = String(req.body.courier_name || "").trim();
        const trackingNumber = String(req.body.tracking_number || "").trim();
        const trackingUrl = String(req.body.tracking_url || "").trim();

        if (!Number.isSafeInteger(trackingId) || trackingId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid tracking entry."
            });
        }

        if (!productName || !courierName || !trackingNumber) {
            return res.status(400).json({
                success: false,
                message: "Product name, courier company aur tracking ID fill karein."
            });
        }

        if (!Number.isSafeInteger(quantity) || quantity < 1) {
            return res.status(400).json({
                success: false,
                message: "Quantity kam az kam 1 honi chahiye."
            });
        }

        if (trackingUrl) {
            try {
                const parsed = new URL(trackingUrl);

                if (!["http:", "https:"].includes(parsed.protocol)) {
                    throw new Error("Invalid protocol");
                }
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Tracking link valid http/https URL hona chahiye."
                });
            }
        }

        const result = await db.query(`
            UPDATE order_tracking_entries
            SET
                product_name = $1,
                quantity = $2,
                courier_name = $3,
                tracking_number = $4,
                tracking_url = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
        `, [
            productName,
            quantity,
            courierName,
            trackingNumber,
            trackingUrl || null,
            trackingId
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Tracking entry nahi mili."
            });
        }

        res.json({
            success: true,
            message: "Tracking entry update ho gayi."
        });

    } catch (error) {
        console.error("Tracking update error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not update tracking entry."
        });
    }
});

// =========================================
// DELETE TRACKING ENTRY
// =========================================

router.delete("/tracking/:trackingId", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.trackingId);

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid tracking entry."
            });
        }

        const result = await db.query(`
            DELETE FROM order_tracking_entries
            WHERE id = $1
        `, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Tracking entry nahi mili."
            });
        }

        res.json({
            success: true,
            message: "Tracking entry delete ho gayi."
        });

    } catch (error) {
        console.error("Tracking delete error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not delete tracking entry."
        });
    }
});

// =========================================
// GET ORDERS BY SECTION
// =========================================

router.get("/", requireAdmin, async (req, res) => {
    try {
        const section = req.query.section || "management";

        const sectionConditions = {
            management: "o.payment_status IN ('pending', 'submitted')",
            approved: "o.payment_status = 'approved' AND o.order_status = 'pending'",
            processing: "o.payment_status = 'approved' AND o.order_status = 'processing'",
            shipped: "o.payment_status = 'approved' AND o.order_status = 'shipped'",
            rejected: "o.payment_status = 'rejected'",
            delivered: "o.order_status = 'delivered' AND o.payment_status != 'rejected'",
            all: "1 = 1"
        };

        if (!Object.prototype.hasOwnProperty.call(sectionConditions, section)) {
            return res.status(400).json({
                success: false,
                message: "Invalid orders section."
            });
        }

        const result = await db.query(`
            SELECT
                o.id,
                o.user_id,
                o.total,
                o.payment_status,
                o.rejection_note,
                o.order_status,
                o.receipt_path,
                o.full_name,
                o.phone,
                o.province,
                o.city,
                o.postal_code,
                o.address,
                o.delivery_instructions,
                o.courier_name,
                o.tracking_number,
                o.tracking_url,
                o.shipped_at,
                o.created_at,
                u.username AS customer_username,
                (
                    SELECT COUNT(*)
                    FROM order_items oi
                    WHERE oi.order_id = o.id
                )::INTEGER AS item_count
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            WHERE ${sectionConditions[section]}
            ORDER BY o.id ASC
        `);

        res.json({
            success: true,
            section,
            orders: result.rows
        });

    } catch (error) {
        console.error("Admin orders list error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load orders."
        });
    }
});

// =========================================
// GET SINGLE ORDER
// =========================================

router.get("/:id", requireAdmin, async (req, res) => {
    try {
        const orderId = Number(req.params.id);

        if (!Number.isSafeInteger(orderId) || orderId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID."
            });
        }

        const orderResult = await db.query(`
            SELECT
                o.*,
                u.username AS customer_username
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            WHERE o.id = $1
        `, [orderId]);

        const order = orderResult.rows[0];

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        const itemsResult = await db.query(`
            SELECT
                id,
                product_id,
                product_name,
                quantity,
                price
            FROM order_items
            WHERE order_id = $1
            ORDER BY id ASC
        `, [orderId]);

        res.json({
            success: true,
            order: {
                ...order,
                items: itemsResult.rows
            }
        });

    } catch (error) {
        console.error("Admin order details error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not load order details."
        });
    }
});

// =========================================
// APPROVE OR REJECT PAYMENT
// =========================================

router.patch("/:id/payment", requireAdmin, async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const paymentStatus = req.body.payment_status;
        const rejectionNote = String(req.body.rejection_note || "").trim();

        if (!Number.isSafeInteger(orderId) || orderId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID."
            });
        }

        if (!["approved", "rejected"].includes(paymentStatus)) {
            return res.status(400).json({
                success: false,
                message: "Payment status must be approved or rejected."
            });
        }

        if (paymentStatus === "rejected" && !rejectionNote) {
            return res.status(400).json({
                success: false,
                message: "Payment reject karne ke liye reason zaroor likhein."
            });
        }

        const orderResult = await db.query(`
            SELECT id, payment_status, receipt_path
            FROM orders
            WHERE id = $1
        `, [orderId]);

        const order = orderResult.rows[0];

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (
            order.payment_status !== "submitted" ||
            !order.receipt_path
        ) {
            return res.status(400).json({
                success: false,
                message: "Only orders with a submitted receipt can be reviewed."
            });
        }

        await db.query(`
            UPDATE orders
            SET
                payment_status = $1,
                rejection_note = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [
            paymentStatus,
            paymentStatus === "rejected" ? rejectionNote : null,
            orderId
        ]);

        res.json({
            success: true,
            message: paymentStatus === "approved"
                ? "Payment approved."
                : "Payment rejected. Reason customer ke order history mein nazar aayega.",
            payment_status: paymentStatus,
            rejection_note: paymentStatus === "rejected"
                ? rejectionNote
                : null
        });

    } catch (error) {
        console.error("Payment review error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not update payment status."
        });
    }
});

// =========================================
// UPDATE ORDER STATUS
// =========================================

router.patch("/:id/status", requireAdmin, async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const { order_status } = req.body;

        const allowedStatuses = [
            "pending",
            "processing",
            "shipped",
            "delivered",
            "cancelled"
        ];

        if (!Number.isSafeInteger(orderId) || orderId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID."
            });
        }

        if (!allowedStatuses.includes(order_status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order status."
            });
        }

        const orderResult = await db.query(`
            SELECT id, payment_status, order_status
            FROM orders
            WHERE id = $1
        `, [orderId]);

        const order = orderResult.rows[0];

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (
            ["processing", "shipped", "delivered"].includes(order_status) &&
            order.payment_status !== "approved"
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment approve hone ke baad hi order process ya ship ho sakta hai."
            });
        }

        if (
            order_status === "processing" &&
            !["pending", "processing"].includes(order.order_status)
        ) {
            return res.status(400).json({
                success: false,
                message: "Order ko Processing mein lane ke liye pehle Approved section mein hona chahiye."
            });
        }

        if (
            order_status === "shipped" &&
            !["processing", "shipped"].includes(order.order_status)
        ) {
            return res.status(400).json({
                success: false,
                message: "Order ko pehle Processing mein move karein."
            });
        }

        if (
            order_status === "delivered" &&
            !["shipped", "delivered"].includes(order.order_status)
        ) {
            return res.status(400).json({
                success: false,
                message: "Order ko Delivered karne se pehle Shipped mark karein."
            });
        }

        if (
            order.order_status === "delivered" &&
            order_status === "shipped"
        ) {
            return res.status(400).json({
                success: false,
                message: "Delivered order ko dobara Shipped nahi kiya ja sakta."
            });
        }

        await db.query(`
            UPDATE orders
            SET
                order_status = $1,
                shipped_at = CASE
                    WHEN $1 = 'shipped'
                    THEN COALESCE(shipped_at, CURRENT_TIMESTAMP)
                    ELSE shipped_at
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [order_status, orderId]);

        res.json({
            success: true,
            message: order_status === "shipped"
                ? "Order Shipped mark ho gaya. 10-day countdown start ho gaya; ab Tracking page ke Shipped tab mein details fill karein."
                : order_status === "delivered"
                    ? "Order manually Delivered mark ho gaya. Automatic timer ab is order ko change nahi karega."
                    : "Order status updated.",
            order_status
        });

    } catch (error) {
        console.error("Order status update error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not update order status."
        });
    }
});

module.exports = router;
