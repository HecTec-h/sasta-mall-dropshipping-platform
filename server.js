
require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const db = require("./database-postgres");

const categoriesRouter = require("./routes/categories");
const productsRouter = require("./routes/products");
const authRouter = require("./routes/auth");
const ordersRouter = require("./routes/orders");
const adminAuthRouter = require("./routes/admin-auth");
const adminProductsRouter = require("./routes/admin-products");
const adminOrdersRouter = require("./routes/admin-orders");
const adminCategoriesRouter = require("./routes/admin-categories");
const supportRouter = require("./routes/support");
const paymentSettingsRouter = require("./routes/payment-settings");

const app = express();

const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET) {
    if (isProduction) {
        throw new Error("SESSION_SECRET must be configured in production.");
    }

    console.warn("WARNING: Using development session secret.");
}

const SESSION_SECRET =
    process.env.SESSION_SECRET || "sasta-mall-development-secret-change-this";

// =========================================
// PROXY CONFIGURATION
// =========================================

if (isProduction) {
    app.set("trust proxy", 1);
}

// =========================================
// MIDDLEWARE
// =========================================

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

// =========================================
// SESSION
// =========================================

app.use(
    session({
        store: new pgSession({
            pool: db,
            tableName: "user_sessions",
            createTableIfMissing: true,
            ttl: 7 * 24 * 60 * 60
        }),

        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);
// =========================================
// SERVE WEBSITE
// =========================================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

app.use(
    "/admin",
    express.static(
        path.join(__dirname, "admin")
    )
);

// =========================================
// API ROUTES
// =========================================

app.use("/api/categories", categoriesRouter);
app.use("/api/products", productsRouter);
app.use("/api/auth", authRouter);
app.use("/api/orders", ordersRouter);

app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/admin/products", adminProductsRouter);
app.use("/api/admin/orders", adminOrdersRouter);
app.use("/api/admin/categories", adminCategoriesRouter);

app.use("/api/support", supportRouter);
app.use("/api/payment-settings", paymentSettingsRouter);

// =========================================
// HOME
// =========================================

app.get("/", (req, res) => {
    res.send("Welcome to Sasta-mall!");
});

// =========================================
// DATABASE TEST
// =========================================

app.get("/api/test-db", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT 1 AS working"
        );

        res.json({
            success: true,
            database: Number(result.rows[0].working) === 1
        });

    } catch (error) {
        console.error("Database test failed:", error.message);

        res.status(500).json({
            success: false,
            database: false,
            error: "Database connection failed."
        });
    }
});

// =========================================
// ERROR HANDLER
// =========================================

app.use((err, req, res, next) => {
    console.error("Server error:", err.message);

    if (res.headersSent) {
        return next(err);
    }

    res.status(err.status || 500).json({
        success: false,
        error: isProduction
            ? "Something went wrong."
            : err.message
    });
});

// =========================================
// START SERVER
// =========================================

app.listen(PORT, () => {
    console.log(
        `Sasta-mall is running at http://localhost:${PORT}`
    );
});
