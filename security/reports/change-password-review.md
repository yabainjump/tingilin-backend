# PATCH /auth/change-password — Authenticated password change

This commit adds a new authenticated endpoint that lets a logged-in user replace their password by supplying their current password, a new password, and receiving a confirmation email. The approach is consistent with the existing reset-password flow: bcrypt comparison, token-version bump via `invalidateRefreshState`, best-effort SMTP, and an audit log entry. All eight security checklist items pass. One blocking logic gap exists: `newPassword` skips the complexity policy (`@Matches` for uppercase + special character) that `ResetPasswordDto` enforces on the same field, leaving a weaker password policy on the change path than on the reset path.

Watch for:
- **Password policy asymmetry (confirmed, blocking)** — `ChangePasswordDto.newPassword` has only `@MinLength(8)`; `ResetPasswordDto.newPassword` additionally requires an uppercase letter and a special character via `@Matches`. A user can change to `"password1"` but cannot reset to it.
- **`currentPassword` accepts empty string (confirmed, non-blocking)** — `@IsString()` without `@IsNotEmpty()` means an empty string passes DTO validation and proceeds to `bcrypt.compare`, which returns `false` and costs a full bcrypt round.

**Verdict**: NEEDS_CHANGES

---

## High-level view

The endpoint is gated correctly: `@UseGuards(AuthGuard('jwt'))` is the first runtime decorator, `@Throttle({ limit: 5, ttl: 5 min })` matches the rate on the reset endpoint, and `req.user.sub` is the only user-identity source — no user-controlled userId parameter in the body or route.

The `newPassword` complexity gap is the only blocking issue. `ResetPasswordDto` enforces `@Matches(/[A-Z]/)` and `@Matches(/[\W_]/)` on top of `@MinLength(8)`. `ChangePasswordDto` only has `@MinLength(8)`. A user can therefore change to a password that would be rejected on the reset path. Adding the two `@Matches` decorators resolves it.

The `currentPassword` field carries no `@IsNotEmpty()`, so an empty string passes the DTO and lands in `bcrypt.compare("", hash)`. The comparison returns `false` and `UnauthorizedException` is thrown — no bypass is possible — but the bcrypt round is wasted. `@IsNotEmpty()` catches it at the validation layer.

---

<details>
<summary>Issues (2)</summary>

1. **Password policy asymmetry** — `ChangePasswordDto.newPassword` lacks `@Matches(/[A-Z]/)` and `@Matches(/[\W_]/)` that `ResetPasswordDto` enforces. Add both decorators to align the change-password path with the reset-password and register paths.
2. **`currentPassword` accepts empty string** — `@IsString()` without `@IsNotEmpty()` allows an empty-string body to reach `bcrypt.compare`. Add `@IsNotEmpty()` to reject it at the validation layer.

</details>

---

<details>
<summary>Details</summary>

### Password policy gap between change and reset paths

`ResetPasswordDto.newPassword` (confirmed, `reset-password.dto.ts` lines 31–39):

```typescript
@IsString()
@MinLength(8)
@Matches(/[A-Z]/, { message: 'password must contain at least 1 uppercase letter' })
@Matches(/[\W_]/, { message: 'password must contain at least 1 special character' })
newPassword!: string;
```

`ChangePasswordDto.newPassword` (confirmed, new file):

```typescript
@IsString()
@MinLength(8)
newPassword: string;
```

The fix is mechanical: copy the two `@Matches` decorators from `ResetPasswordDto` and add `Matches` to the `class-validator` import.

</details>

---

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `src/modules/auth/dto/change-password.dto.ts` | New DTO — `currentPassword` (string) and `newPassword` (string, MinLength 8) |
| `src/modules/auth/auth.service.ts` | New `changePassword` method and private `sendPasswordChangeConfirmationEmail` helper |
| `src/modules/auth/auth.controller.ts` | New `PATCH /auth/change-password` endpoint with JWT guard and throttle |

Full diff: `git -C <repo> diff HEAD~1 HEAD`

</details>
