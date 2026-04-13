import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "pa-medtrack-dev-secret-changeme",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

app.use("/api", router);

export async function setupFrontend(appInstance: Express): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    const frontendDist = path.resolve(__dirname, "../../pa-medtrack/dist/public");
    appInstance.use(express.static(frontendDist));
    appInstance.use((_req: Request, res: Response) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    const { createServer } = await import("vite");
    const react = (await import("@vitejs/plugin-react")).default;
    const tailwindcss = (await import("@tailwindcss/vite")).default;

    const frontendRoot = path.resolve(__dirname, "../../../artifacts/pa-medtrack");

    const vite = await createServer({
      root: frontendRoot,
      base: "/",
      configFile: false,
      plugins: [
        react(),
        tailwindcss(),
      ],
      resolve: {
        alias: {
          "@": path.join(frontendRoot, "src"),
          "@assets": path.resolve(frontendRoot, "..", "..", "attached_assets"),
        },
        dedupe: ["react", "react-dom"],
      },
      server: {
        middlewareMode: true,
        hmr: true,
        allowedHosts: true,
        fs: {
          strict: false,
          allow: [
            frontendRoot,
            path.resolve(frontendRoot, "../.."),
          ],
        },
      },
      appType: "spa",
    });

    appInstance.use(vite.middlewares);

    appInstance.use(async (req: Request, res: Response, next: NextFunction) => {
      if (req.url.startsWith("/api")) {
        return next();
      }
      try {
        const indexPath = path.join(frontendRoot, "index.html");
        let template = readFileSync(indexPath, "utf-8");
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }
}

export default app;
