## Review Plan: whatsapp-pi-fix → Upstream Deployment

### Phase 1: Security & Privacy Audit
- [ ] Scan ALL commit-able files for real PII (phone numbers, JIDs, auth tokens)
- [ ] Check .gitignore coverage — does it protect ALL data paths?
- [ ] Audit session.manager.ts: file permissions, temp file safety, audit log hygiene
- [ ] Audit whatsapp.service.ts: socket security, credential handling, QR exposure
- [ ] Check whatsapp-pi.ts: tool parameter validation, flag handling, error boundaries

### Phase 2: Package Alignment
- [ ] Compare package.json with upstream (dependencies, devDependencies, scripts, pi section)
- [ ] Verify @sinclair/typebox dependency is justified and used
- [ ] Check @earendil-works vs @mariozechner package conflict risk
- [ ] Verify version bump convention matches upstream pattern
- [ ] Check `files` array covers everything needed for npm publish

### Phase 3: Code Quality
- [ ] Run npm test (must pass 155/155)
- [ ] Run npx tsc --noEmit (must be zero errors)
- [ ] Run npm run lint (must be zero)
- [ ] Check for dead code, unused imports, console.log leaks
- [ ] Error handling: are all try/catch blocks meaningful?

### Phase 4: Documentation
- [ ] README.md accuracy vs actual code (flags, commands, features)
- [ ] AGENTS.md completeness for project maintenance
- [ ] Audit docs: are they deployment-ready or contain internal notes?
- [ ] Missing: CHANGELOG.md? LICENSE file? CONTRIBUTING.md?

### Phase 5: Deployment Readiness
- [ ] Does the PR description explain everything a reviewer needs?
- [ ] Are commit messages conventional and informative?
- [ ] Is the branch clean (no merge conflicts with upstream master)?
- [ ] What would a reviewer flag that we missed?

### Phase 6: Final Verdict
- [ ] CRITICAL issues → block merge
- [ ] SUGGESTIONS → improve but don't block
- [ ] OBSERVATIONS → FYI
