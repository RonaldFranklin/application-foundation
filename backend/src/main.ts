import { readConfig } from "./infra/config/config";
import { createApp } from "./app";
import { BootstrapMaster } from "./application/auth/use-cases/bootstrap-master";
import { AuthCleanup } from "./infra/scheduling/auth-cleanup";
async function main() {
  const config = readConfig();
  const app = await createApp(config);
  try {
    await app.get(BootstrapMaster).init();
    app.enableShutdownHooks();
    app.get(AuthCleanup).start();
    await app.listen(config.PORT, "0.0.0.0");
    console.info(
      JSON.stringify({ event: "server_started", port: config.PORT }),
    );
  } catch (error) {
    await app.close();
    throw error;
  }
}
main().catch(() => {
  console.error(
    "Falha ao iniciar. Verifique configuração, migrações e conectividade.",
  );
  process.exitCode = 1;
});
