// Convert the repository's portable placeholders to PostgreSQL parameters while
// leaving bound values, quoted literals, and identifiers untouched.
function postgresSql(sql) {
  let index = 0;
  return sql.split(/('(?:''|[^'])*'|"(?:""|[^"])*")/g).map((part, i) => i % 2 ? part : part
    .replace(/\?/g, () => `$${++index}`)
    .replace(/\bAS\s+([a-zA-Z_][\w]*)/g, (_, alias) => `AS "${alias}"`)).join('');
}
module.exports = { postgresSql };
