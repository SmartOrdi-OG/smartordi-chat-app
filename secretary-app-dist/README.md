# secretary-app-dist/

This is a **committed build output**, not source. It's the production build of
`secretary-app/` (`npm run build`, with `base: '/secretary-app-dist/'` set in
`secretary-app/vite.config.js`), served statically by the root app's own
`vercel.json` under the `/secretary` route -- the smartordi-chat-app Vercel
project has no build step of its own (pure static hosting), so there's
nowhere else for this to be generated at deploy time.

**Whenever `secretary-app/src/*` changes and should reach production**,
rebuild and recommit this folder:

```sh
cd secretary-app && VITE_BASE_PATH=/secretary-app-dist/ npm run build
cd .. && rm -rf secretary-app-dist && cp -r secretary-app/dist secretary-app-dist
git add secretary-app-dist secretary-app
git commit -m "Rebuild secretary-app-dist"
```

**This step wiped out this very README** (`rm -rf` removes the whole folder,
and this file lives alongside the build output, not inside `secretary-app/dist`
itself) -- recreate it from git history (`git show HEAD:secretary-app-dist/README.md`)
or copy it back in before committing, same as this rebuild had to.

`secretary-app`'s own separate Vercel project (`smartordi-secretary.vercel.app`)
stays the live-reloading place to test changes -- this folder is only what
actually serves `/secretary` in production.

`secretary.html` stays in the repo, unused by any route, as an easy one-line
rollback (`vercel.json`'s `/secretary` entry) until this cutover has proven
stable.
