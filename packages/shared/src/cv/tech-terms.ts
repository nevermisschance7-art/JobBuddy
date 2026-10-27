// Technologies the truth checker watches for. If a tailored CV mentions one of these and the
// confirmed CV doesn't, it was invented. Also used to list a job's requirements the CV lacks.
// Lower case; matched as whole words. Words that are also plain English (Go, C, R, REST,
// Spring, Express) are left out or written in a safer form, to avoid false alarms.

export const TECH_TERMS: string[] = [
  // languages
  "python", "java", "javascript", "typescript", "golang", "rust", "c++", "c#", "ruby",
  "php", "kotlin", "swift", "objective-c", "scala", "elixir", "erlang", "haskell", "clojure",
  "dart", "matlab", "perl", "lua", "julia", "f#", "groovy", "solidity", "sql", "bash",
  "powershell", "zig", "ocaml", "cobol", "fortran",
  // web and mobile
  "react", "react native", "next.js", "vue", "nuxt", "angular", "svelte", "sveltekit",
  "redux", "tailwind", "jquery", "node.js", "deno", "express.js", "nestjs", "fastify",
  "django", "flask", "fastapi", "ruby on rails", "laravel", "symfony", "spring boot",
  ".net", "asp.net", "blazor", "flutter", "ionic", "electron", "graphql", "rest api", "grpc",
  "websocket", "webassembly", "html", "css", "sass", "webpack", "vite", "storybook",
  // data and ml
  "pandas", "numpy", "scipy", "pytorch", "tensorflow", "keras", "scikit-learn", "spark",
  "pyspark", "hadoop", "airflow", "dbt", "kafka", "flink", "snowflake", "databricks",
  "bigquery", "redshift", "looker", "tableau", "power bi", "mlflow", "hugging face", "langchain",
  "llm", "rag", "openai", "nlp", "computer vision", "opencv",
  // databases
  "postgresql", "mysql", "mariadb", "sqlite", "mongodb", "redis", "elasticsearch",
  "opensearch", "cassandra", "dynamodb", "couchdb", "neo4j", "clickhouse", "oracle",
  "sql server", "firebase", "supabase", "prisma", "sqlalchemy", "hibernate",
  // cloud, infra, devops
  "aws", "azure", "gcp", "google cloud", "lambda", "ec2", "s3", "ecs", "eks", "cloudformation",
  "kubernetes", "docker", "helm", "terraform", "pulumi", "ansible", "puppet", "jenkins",
  "github actions", "gitlab ci", "circleci", "argocd", "prometheus", "grafana", "datadog",
  "new relic", "splunk", "elk", "nginx", "linux", "istio", "vault", "consul", "serverless",
  "cloudflare", "vercel", "netlify", "heroku", "openshift", "rabbitmq", "sqs", "pub/sub",
  // practices and tools
  "microservices", "ci/cd", "tdd", "graphql", "oauth", "jwt", "git", "jira", "figma",
  "selenium", "cypress", "playwright", "jest", "pytest", "junit", "salesforce", "sap",
  "shopify", "wordpress", "unity", "unreal",
]; // prettier-ignore

/** Spellings that mean the same technology. Keys and values are lower case. */
export const TECH_SYNONYMS: Record<string, string> = {
  postgres: "postgresql",
  "k8s": "kubernetes",
  js: "javascript",
  ts: "typescript",
  nodejs: "node.js",
  nextjs: "next.js",
  "react.js": "react",
  reactjs: "react",
  "vue.js": "vue",
  "google cloud platform": "gcp",
  "google cloud": "gcp",
  "amazon web services": "aws",
  "microsoft azure": "azure",
  "c sharp": "c#",
  "dotnet": ".net",
  "sklearn": "scikit-learn",
  "mongo": "mongodb",
  "ms sql": "sql server",
  "mssql": "sql server",
  "gh actions": "github actions",
}; // prettier-ignore
