import pino from "pino";
import { config } from "../config/config";

const isProduction = config.server.nodeEnv === "production";

export const logger = pino({
  level: config.logging.level,
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
});

export default logger;
