# mymodel — CLI for self-hosting your semantic router (Brick)

```bash
npm install
npm run build
./bin/run.js init      # guided wizard → ~/.mymodel/config.yaml
./bin/run.js serve     # docker compose up (image: mymodel:latest)
./bin/run.js chat      # REPL against http://localhost:8000
./bin/run.js route "<prompt>"
./bin/run.js stop
```

Config lives at `~/.mymodel/config.yaml`. API keys at `~/.mymodel/.env` (chmod 600). YAML schema is aligned with the upstream router (`semantic-routing/config.yaml`).
