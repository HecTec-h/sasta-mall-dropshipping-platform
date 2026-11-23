
const express = require("express");
const db = require("../database-postgres");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const router = express.Router();

// RECEIPT UPLOAD CONFIGURATION
const receiptDir = path.join(
    __dirname,
    "../public/uploads/receipts"
);

fs.mkdirSync(receiptDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, receiptDir);
    },

    filename: (req, file, cb) => {
        const uniqueName =
            Date.now() +
            "-" +
            crypto.randomBytes(12).toString("hex") +
            path.extname(file.originalname).toLowerCase();

        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed."));
        }
    }
});

function removeUploadedFile(file) {
    if (file?.path) {
        fs.unlink(file.path, () => {});
    }
}

function validOrderId(value) {
    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0
        ? id
        : null;
}

// DATABASE TRANSACTION HELPER
async function withTransaction(callback) {
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const result = await callback(client);

        await client.query("COMMIT");

        return result;

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error(
                "Order transaction rollback failed:",
                rollbackError.message
            );
        }

        throw error;

    } finally {
        client.release();
    }
}

// =========================================
// CREATE ORDER
// =========================================

router.post("/", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                error: "Please login before placing an order."
            });
        }

        const userResult = await db.query(`
            SELECT id, name, phone
            FROM users
            WHERE id = $1
        `, [req.session.userId]);

        const user = userResult.rows[0];

        if (!user) {
            return res.status(401).json({
                success: false,
                error: "User account not found."
            });
        }

        const {
            fullName,
            phone,
            province,
            city,
            postalCode,
            address,
            deliveryInstructions,
            cart
        } = req.body;

        if (
            !fullName ||
            !phone ||
            !province ||
            !city ||
            !postalCode ||
            !address
        ) {
            return res.status(400).json({
                success: false,
                error: "All required delivery fields must be filled."
            });
        }

        if (
            typeof fullName !== "string" ||
            typeof phone !== "string" ||
            typeof province !== "string" ||
            typeof city !== "string" ||
            typeof postalCode !== "string" ||
            typeof address !== "string" ||
            typeof deliveryInstructions !== "undefined" &&
            typeof deliveryInstructions !== "string"
        ) {
            return res.status(400).json({
                success: false,
                error: "Invalid delivery information."
            });
        }

        if (!/^\d{5}$/.test(postalCode.trim())) {
            return res.status(400).json({
                success: false,
                error: "Postal code must be exactly 5 digits."
            });
        }

        if (
            !Array.isArray(cart) ||
            cart.length === 0 ||
            cart.length > 100
        ) {
            return res.status(400).json({
                success: false,
                error: "Your cart is empty or invalid."
            });
        }

        const orderResult = await withTransaction(async client => {
            const orderItems = [];
            let total = 0;

            for (const cartItem of cart) {
                const productId = Number(cartItem.id);
                const quantity = Number(cartItem.quantity);

                if (
                    !Number.isSafeInteger(productId) ||
                    productId <= 0 ||
                    !Number.isSafeInteger(quantity) ||
                    quantity <= 0
                ) {
                    return {
                        error: "Invalid cart item.",
                        status: 400
                    };
                }

                const productResult = await client.query(`
                    SELECT
                        id,
                        name,
                        price,
                        stock
                    FROM products
                    WHERE id = $1
                      AND active = 1
                    FOR UPDATE
                `, [productId]);

                const product = productResult.rows[0];

                if (!product) {
                    return {
                        error: `Product ${productId} is no longer available.`,
                        status: 400
                    };
                }

                if (quantity > Number(product.stock)) {
                    return {
                        error: `${product.name} does not have enough stock.`,
                        status: 400
                    };
                }

                const itemTotal = Number(product.price) * quantity;

                if (!Number.isSafeInteger(itemTotal)) {
                    return {
                        error: "Invalid product price.",
                        status: 400
                    };
                }

                total += itemTotal;

                if (!Number.isSafeInteger(total)) {
                    return {
                        error: "Order total is invalid.",
                        status: 400
                    };
                }

                orderItems.push({
                    productId: product.id,
                    productName: product.name,
                    quantity,
                    price: product.price
                });
            }

            const createdOrder = await client.query(`
                INSERT INTO orders (
                    user_id,
                    total,
                    payment_status,
                    rejection_note,
                    order_status,
                    full_name,
                    phone,
                    province,
                    city,
                    postal_code,
                    address,
                    delivery_instructions
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11, $12
                )
                RETURNING id
            `, [
                user.id,
                total,
                "pending",
                null,
                "pending",
                fullName.trim(),
                phone.trim(),
                province.trim(),
                city.trim(),
                postalCode.trim(),
                address.trim(),
                deliveryInstructions
                    ? deliveryInstructions.trim()
                    : null
            ]);

            const orderId = createdOrder.rows[0].id;

            for (const item of orderItems) {
                await client.query(`
                    INSERT INTO order_items (
                        order_id,
                        product_id,
                        product_name,
                        quantity,
                        price
                    )
                    VALUES ($1, $2, $3, $4, $5)
                `, [
                    orderId,
                    item.productId,
                    item.productName,
                    item.quantity,
                    item.price
                ]);
            }

            return {
                orderId,
                total
            };
        });

        if (orderResult.error) {
            return res.status(orderResult.status).json({
                success: false,
                error: orderResult.error
            });
        }

        return res.json({
            success: true,
            message: "Order created successfully.",
            orderId: orderResult.orderId,
            total: orderResult.total
        });

    } catch (error) {
        console.error("Create order error:", error.message);

        return res.status(500).json({
            success: false,
            error: "Could not create order."
        });
    }
});

// =========================================
// UPLOAD PAYMENT RECEIPT
// =========================================

router.post(
    "/:id/receipt",

    (req, res, next) => {
        upload.single("receipt")(req, res, error => {
            if (error) {
                console.error("Receipt upload error:", error.message);

                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }

            next();
        });
    },

    async (req, res) => {
        try {
            if (!req.session.userId) {
                removeUploadedFile(req.file);

                return res.status(401).json({
                    success: false,
                    error: "Please login first."
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: "Please upload a receipt image."
                });
            }

            const orderId = validOrderId(req.params.id);

            if (!orderId) {
                removeUploadedFile(req.file);

                return res.status(400).json({
                    success: false,
                    error: "Invalid order ID."
                });
            }

            const receiptPath =
                "/uploads/receipts/" + req.file.filename;

            const result = await db.query(`
                UPDATE orders
                SET
                    receipt_path = $1,
                    payment_status = 'submitted',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                  AND user_id = $3
                RETURNING id
            `, [
                receiptPath,
                orderId,
                req.session.userId
            ]);

            if (result.rowCount === 0) {
                removeUploadedFile(req.file);

                return res.status(404).json({
                    success: false,
                    error: "Order not found."
                });
            }

            return res.json({
                success: true,
                message: "Payment receipt uploaded successfully."
            });

        } catch (error) {
            removeUploadedFile(req.file);

            console.error("Receipt upload error:", error.message);

            return res.status(500).json({
                success: false,
                error: "Could not upload payment receipt."
            });
        }
    }
);

// =========================================
// CUSTOMER ORDER HISTORY
// =========================================

router.get("/mine", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                error: "Please login first."
            });
        }

        const ordersResult = await db.query(`
            SELECT
                id,
                total,
                payment_status,
                rejection_note,
                order_status,
                full_name,
                phone,
                province,
                city,
                postal_code,
                address,
                delivery_instructions,
                created_at
            FROM orders
            WHERE user_id = $1
            ORDER BY id DESC
        `, [req.session.userId]);

        const orders = ordersResult.rows;

        const result = await Promise.all(
            orders.map(async order => {
                const [
                    itemsResult,
                    adminTrackingResult,
                    legacyTrackingResult
                ] = await Promise.all([
                    db.query(`
                        SELECT
                            id,
                            product_id,
                            product_name,
                            quantity,
                            price
                        FROM order_items
                        WHERE order_id = $1
                        ORDER BY id ASC
                    `, [order.id]),

                    db.query(`
                        SELECT
                            id,
                            product_name,
                            quantity,
                            courier_name,
                            tracking_number,
                            tracking_url
                        FROM order_tracking_entries
                        WHERE order_id = $1
                        ORDER BY id ASC
                    `, [order.id]),

                    db.query(`
                        SELECT
                            t.id,
                            t.unit_number,
                            t.quantity_covered,
                            t.courier_name,
                            t.tracking_number,
                            t.tracking_url,
                            oi.product_name
                        FROM order_item_tracking t
                        JOIN order_items oi
                            ON oi.id = t.order_item_id
                        WHERE t.order_id = $1
                          AND TRIM(COALESCE(t.courier_name, '')) != ''
                          AND TRIM(COALESCE(t.tracking_number, '')) != ''
                        ORDER BY oi.id ASC, t.unit_number ASC
                    `, [order.id])
                ]);

                return {
                    ...order,
                    items: itemsResult.rows,
                    tracking: [
                        ...adminTrackingResult.rows,
                        ...legacyTrackingResult.rows
                    ]
                };
            })
        );

        return res.json({
            success: true,
            orders: result
        });

    } catch (error) {
        console.error("Customer order history error:", error.message);

        return res.status(500).json({
            success: false,
            error: "Could not load your orders."
        });
    }
});

// =========================================
// UPDATE DELIVERY DETAILS
// =========================================

router.patch("/:id/delivery", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                error: "Please login first."
            });
        }

        const orderId = validOrderId(req.params.id);

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: "Invalid order."
            });
        }

        const fullName = String(req.body.fullName || "").trim();
        const phone = String(req.body.phone || "").trim();
        const province = String(req.body.province || "").trim();
        const city = String(req.body.city || "").trim();
        const postalCode = String(req.body.postalCode || "").trim();
        const address = String(req.body.address || "").trim();
        const deliveryInstructions =
            String(req.body.deliveryInstructions || "").trim();

        if (
            !fullName ||
            !phone ||
            !province ||
            !city ||
            !postalCode ||
            !address
        ) {
            return res.status(400).json({
                success: false,
                error: "Please complete all required delivery fields."
            });
        }

        if (!/^\d{5}$/.test(postalCode)) {
            return res.status(400).json({
                success: false,
                error: "Postal code must be exactly 5 digits."
            });
        }

        const result = await db.query(`
            UPDATE orders
            SET
                full_name = $1,
                phone = $2,
                province = $3,
                city = $4,
                postal_code = $5,
                address = $6,
                delivery_instructions = $7,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $8
              AND user_id = $9
              AND LOWER(order_status) NOT IN ('shipped', 'delivered')
            RETURNING
                id,
                total,
                payment_status,
                order_status,
                full_name,
                phone,
                province,
                city,
                postal_code,
                address,
                delivery_instructions,
                created_at
        `, [
            fullName,
            phone,
            province,
            city,
            postalCode,
            address,
            deliveryInstructions || null,
            orderId,
            req.session.userId
        ]);

        if (result.rowCount === 0) {
            const orderCheck = await db.query(`
                SELECT id, order_status
                FROM orders
                WHERE id = $1
                  AND user_id = $2
            `, [orderId, req.session.userId]);

            if (orderCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "Order not found."
                });
            }

            return res.status(409).json({
                success: false,
                error: "This order has shipped, so delivery details can no longer be edited. Please contact Customer Support."
            });
        }

        return res.json({
            success: true,
            message: "Delivery details updated.",
            order: result.rows[0]
        });

    } catch (error) {
        console.error("Delivery details update error:", error.message);

        return res.status(500).json({
            success: false,
            error: "Could not update delivery details."
        });
    }
});

// =========================================
// GET SINGLE ORDER
// =========================================

router.get("/:id", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                error: "Please login first."
            });
        }

        const orderId = validOrderId(req.params.id);

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: "Invalid order ID."
            });
        }

        const orderResult = await db.query(`
            SELECT
                id,
                user_id,
                total,
                payment_status,
                order_status,
                full_name,
                phone,
                province,
                city,
                postal_code,
                address,
                delivery_instructions,
                receipt_path,
                courier_name,
                tracking_number,
                tracking_url,
                shipped_at,
                created_at
            FROM orders
            WHERE id = $1
              AND user_id = $2
        `, [
            orderId,
            req.session.userId
        ]);

        const order = orderResult.rows[0];

        if (!order) {
            return res.status(404).json({
                success: false,
                error: "Order not found."
            });
        }

        const [
            itemsResult,
            adminTrackingResult,
            legacyTrackingResult
        ] = await Promise.all([
            db.query(`
                SELECT
                    id,
                    product_id,
                    product_name,
                    quantity,
                    price
                FROM order_items
                WHERE order_id = $1
                ORDER BY id ASC
            `, [order.id]),

            db.query(`
                SELECT
                    id,
                    product_name,
                    quantity,
                    courier_name,
                    tracking_number,
                    tracking_url
                FROM order_tracking_entries
                WHERE order_id = $1
                ORDER BY id ASC
            `, [order.id]),

            db.query(`
                SELECT
                    t.id,
                    t.unit_number,
                    t.quantity_covered,
                    t.courier_name,
                    t.tracking_number,
                    t.tracking_url,
                    oi.product_name
                FROM order_item_tracking t
                JOIN order_items oi
                    ON oi.id = t.order_item_id
                WHERE t.order_id = $1
                  AND TRIM(COALESCE(t.courier_name, '')) != ''
                  AND TRIM(COALESCE(t.tracking_number, '')) != ''
                ORDER BY oi.id ASC, t.unit_number ASC
            `, [order.id])
        ]);

        return res.json({
            success: true,
            order: {
                ...order,
                items: itemsResult.rows,
                tracking: [
                    ...adminTrackingResult.rows,
                    ...legacyTrackingResult.rows
                ]
            }
        });

    } catch (error) {
        console.error("Get order error:", error.message);

        return res.status(500).json({
            success: false,
            error: "Could not load order."
        });
    }
});

module.exports = router;
