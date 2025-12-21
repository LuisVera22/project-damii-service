export class UsersController {
  constructor({ usersService }) {
    this.usersService = usersService;
  }

  createUser = async (req, res, next) => {
    try {
      const { firstName, lastName, role, email } = req.body;

      if (!firstName || !lastName || !role || !email) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const allowedRoles = ["user", "admin", "superadmin"];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      const result = await this.usersService.createUserAndInvite({
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        role,
        email: String(email).trim(),
        createdByUid: req.user.uid,
      });

      return res.status(201).json({ ok: true, uid: result.uid });
    } catch (e) {
      // Mapeo útil (email existente, etc.)
      if (String(e?.code || "").includes("email-already-exists")) {
        return res.status(409).json({ ok: false, message: "El email ya existe" });
      }

      return next(e);
    }
  };
}
