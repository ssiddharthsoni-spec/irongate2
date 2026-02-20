/**
 * Iron Gate Protocol Buffer definitions placeholder.
 * Will contain gRPC service definitions for the detection service.
 */

export const DETECTION_SERVICE = {
  serviceName: 'iron_gate.detection.v1.DetectionService',
  methods: {
    detectEntities: {
      path: '/iron_gate.detection.v1.DetectionService/DetectEntities',
      requestStream: false,
      responseStream: false,
    },
    scoreText: {
      path: '/iron_gate.detection.v1.DetectionService/ScoreText',
      requestStream: false,
      responseStream: false,
    },
    streamDetection: {
      path: '/iron_gate.detection.v1.DetectionService/StreamDetection',
      requestStream: true,
      responseStream: true,
    },
  },
} as const;
