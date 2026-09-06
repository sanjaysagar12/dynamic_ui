# shared-types

Shared TypeScript vocabulary (currently: the `Role` type, `ROLES`, `isRole()`) used by both Node services and the Next.js app's browser bundle. Holds no auth/token logic — token minting and verification live in `services/tool-service/src/auth/jwt.ts`; this package only carries the role vocabulary every side needs to agree on.

## Building

Run `nx build shared-types` to build the library.

## Running unit tests

Run `nx test shared-types` to execute the unit tests via [Jest](https://jestjs.io).
