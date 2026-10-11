import dotenv from "dotenv";
import path from "path";

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
  },
  whatsapp: {
    dataPath: process.env.WHATSAPP_DATA_PATH || path.join(process.cwd(), "data", "sessions"),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
};
