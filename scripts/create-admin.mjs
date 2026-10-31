// Creates the first admin on a fresh deployment, where the dev seed is refused.
// Usage: npm run admin:create -- "Your Name" you@example.com "a-strong-password"
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password) {
  console.error('Usage: npm run admin:create -- "Your Name" you@example.com "a-strong-password"');
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}

const db = new PrismaClient();
try {
  const user = await db.user.create({
    data: { name, email: email.trim().toLowerCase(), role: "ADMIN", passwordHash: await bcrypt.hash(password, 12) },
  });
  console.log(`Admin created: ${user.email}`);
} catch (err) {
  console.error(err.code === "P2002" ? "A user with this email already exists" : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
