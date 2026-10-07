import EmbeddedPostgres from "embedded-postgres";
const pg = new EmbeddedPostgres({ databaseDir: "C:/vt-tmp/pgdata-onchain", user: "postgres", password: "pw", port: 15432, persistent: false });
await pg.initialise();
await pg.start();
console.log("READY");
setInterval(() => {}, 1 << 30);
