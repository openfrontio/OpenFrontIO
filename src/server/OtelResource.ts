import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";

const config = getServerConfigFromServer();

export function getOtelResource() {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "openfront",
    [ATTR_SERVICE_VERSION]: "1.0.0",
    ...getPromLabels(),
  });
}

export function getPromLabels() {
  return {
    "openfront.component": process.env.WORKER_ID
      ? "Worker " + process.env.WORKER_ID
      : "Master",
    "openfront.domain": process.env.DOMAIN,

    "openfront.environment": config.env(),
    "openfront.host": process.env.HOST,
    "openfront.subdomain": process.env.SUBDOMAIN,
    "service.instance.id": process.env.HOSTNAME,
  };
}
