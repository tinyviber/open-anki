declare module 'better-sqlite3' {
  const BetterSqlite3: any;
  export default BetterSqlite3;
}

declare module 'bun:sqlite' {
  export const Database: any;
  const BunSqlite: any;
  export default BunSqlite;
}
