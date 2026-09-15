# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or exposed credential.
Contact the repository owner through the email address on the associated GitHub profile
and include only the minimum information needed to reproduce the problem.

## Secrets

- Keep local credentials in `.env`; the file is ignored by Git.
- Commit only `.env.example` files with empty or clearly non-production values.
- Use repository or deployment-platform secrets for CI and production.
- Treat every credential committed to Git history as compromised and rotate it before
  rewriting the history.

