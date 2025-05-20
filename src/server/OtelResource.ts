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
    "service.instance.id": process.env.HOSTNAME,
    "openfront.environment": config.env(),
    "openfront.host": process.env.HOST,
    "openfront.domain": process.env.DOMAIN,
    "openfront.subdomain": process.env.SUBDOMAIN,
    "openfront.component": process.env.WORKER_ID
      ? "Worker " + process.env.WORKER_ID
      : "Master",
    // The comma-separated list tells OpenTelemetry which resource attributes
    // should be converted to Loki labels
    "loki.resource.labels":
      "service.name,service.instance.id,openfront.environment,openfront.host,openfront.domain,openfront.subdomain,openfront.component",
  });
}
