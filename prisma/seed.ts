import { bootstrapCloudora } from "../server/bootstrap";

bootstrapCloudora()
  .then(() => {
    console.log("Cloudora seed complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
