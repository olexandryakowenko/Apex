import jwt from "jsonwebtoken";

export function makeToken() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing");
  const token = jwt.sign(
    { role: "admin" },
    secret,
    { expiresIn: "7d" }
  );
  return token;
}

export function requireAdmin(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: "JWT_SECRET missing" });

  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, secret);
    if (payload?.role !== "admin") throw new Error("bad role");
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
