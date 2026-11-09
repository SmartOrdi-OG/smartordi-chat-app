# patient-app-dist/

This is a **committed build output**, not source. It's the production build of
`patient-app/` (`npm run build`, with `base: '/patient-app-dist/'` set in
`patient-app/vite.config.js`), served statically by the root app's own
`vercel.json` under the `/patient`, `/patient-login`, and `/patient-register`
routes -- the smartordi-chat-app Vercel project has no build step of its own
(pure static hosting), so there's nowhere else for this to be generated at
deploy time.

**Whenever `patient-app/src/*` changes and should reach production**, rebuild
and recommit this folder:

```sh
cd patient-app && npm run build
cd .. && rm -rf patient-app-dist && cp -r patient-app/dist patient-app-dist
git add patient-app-dist patient-app
git commit -m "Rebuild patient-app-dist"
```

Until this is out of beta, `patient-app`'s own separate Vercel project
(`smartordi-patient.vercel.app`) stays the live-reloading place to test
changes -- this folder is only what actually serves `chat.smartordiog.eu`.
