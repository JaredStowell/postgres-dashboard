# Repository Instructions

- Use the local `main` branch. Do not create worktrees unless explicitly requested.
- Send a concise summary to the project's Discord channel after every turn. Include metrics and benchmarks when available.
- Performance is a product requirement. Bound database queries, split heavy client code, and measure important paths.
- Test every change in proportion to risk. Database and EXPLAIN changes require real PostgreSQL integration coverage.
- Commit cohesive, reviewed slices regularly and push `main` when their focused verification passes.
- Never commit credentials, connection strings containing secrets, OpenAI keys, or generated Cloudflare identifiers.
