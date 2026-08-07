const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
console.log("CWD:", process.cwd());
console.log("DATABASE_URL:", process.env.DATABASE_URL || "not set");
p.user.findFirst().then(u => {
  console.log("User found:", u ? u.email : "null");
  p.$disconnect();
}).catch(e => {
  console.log("Error:", e.message.substring(0, 300));
  p.$disconnect();
});
