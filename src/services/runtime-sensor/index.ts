// kilocode_change - new file
export {
	RUNTIME_SENSOR_DIR_NAME,
	RUNTIME_SENSOR_LATEST_FILE,
	RUNTIME_SENSOR_EVENTS_FILE,
	RUNTIME_SENSOR_GRAY_FILE,
	DEFAULT_INTERVAL_MS,
	DEFAULT_THROTTLE_MS,
	DEFAULT_MAX_EVENTS,
	GRAY_KINDS,
	RuntimeSensor,
	bytesToMb,
	classifyWebviewGray,
	clipText,
	collectHostMetrics,
	createFileWriter,
	defaultSensorDirectories,
	isGrayKind,
} from "./RuntimeSensor"
export type {
	RuntimeSensorError,
	RuntimeSensorHostMetrics,
	RuntimeSensorHostState,
	RuntimeSensorOptions,
	RuntimeSensorSnapshot,
	RuntimeSensorSource,
	RuntimeSensorWebviewMetrics,
	RuntimeSensorWriter,
} from "./RuntimeSensor"
