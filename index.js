import express from "express";
import cookieParser from "cookie-parser";
import config from "./source/config.js";
import authRoutes from "./source/routes/authRoutes.js";
import profileRoutes from "./source/routes/profileRoutes.js";
 
const app = express();




app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);

/**
 * @openapi
 * /:
 *   get:
 *     tags: [General]
 *     summary: Get the API welcome message
 *     responses:
 *       200:
 *         description: Welcome message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Welcome to the home page }
 */
app.get("/", (req, res) => {

    res.status(200).json({"message":"Welcome to the home page"})
});


app.listen(config.PORT, () => {

  console.log(`Server is running on port ${config.PORT}`);

});