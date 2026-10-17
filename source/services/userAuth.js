import bcrypt from "bcryptjs";
import prisma from "../db/client.js";
import { issueTokenPair, setRefreshCookie } from "./sessionService.js";

const SALT_ROUNDS = 12;
// Used so an unknown email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", SALT_ROUNDS);

const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);
const comparePasswords = (plain, hashed) => bcrypt.compare(plain, hashed);

export async function signup(req, res) {
  try {
    const { username: name, email, password } = req.body; // already validated and sanitised

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    // Start a session family; the refresh token goes out as an
    // httpOnly cookie, the short-lived JWT in the response body.
    const { accessToken, refreshToken } = await issueTokenPair(user.id, req);
    setRefreshCookie(res, refreshToken);
    return res.status(201).json({ message: "User created successfully", token: accessToken, user });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "User already exists" });
    }
    console.error("signup failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true, name: true, email: true, role: true, createdAt: true,
        passwordHash: true, status: true, deletedAt: true,
      },
    });

    const isValid = await comparePasswords(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !isValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    if (user.deletedAt || user.status !== "ACTIVE") {
      return res.status(403).json({ message: "Account is disabled" });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const { passwordHash, status, deletedAt, ...safeUser } = user;
    const { accessToken, refreshToken } = await issueTokenPair(user.id, req);
    setRefreshCookie(res, refreshToken);
    return res.status(200).json({ message: "Login successful", token: accessToken, user: safeUser });
  } catch (error) {
    console.error("login failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
