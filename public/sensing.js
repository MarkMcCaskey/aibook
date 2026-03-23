// Loop 1: MediaPipe Face Detection (~100ms via requestAnimationFrame)
// Owns webcam lifecycle and raw blend shape extraction.
// MediaPipe is loaded via <script> tag and available on window.

let faceLandmarker = null;
let videoElement = null;
let latestBlendShapes = null;
let latestHeadMatrix = null;
let faceDetected = false;
let onUpdateCallback = null;

export function getLatestBlendShapes() {
  return latestBlendShapes;
}

export function getHeadMatrix() {
  return latestHeadMatrix;
}

export function isFaceDetected() {
  return faceDetected;
}

export function onBlendShapeUpdate(cb) {
  onUpdateCallback = cb;
}

export async function initSensing() {
  console.log('[sensing] Starting MediaPipe initialization...');

  // Dynamic import from CDN (.mjs is the only format available)
  const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.33/vision_bundle.mjs');
  const { FaceLandmarker, FilesetResolver } = vision;

  console.log('[sensing] FilesetResolver loading WASM...');
  const filesetResolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.33/wasm'
  );

  console.log('[sensing] Creating FaceLandmarker...');
  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    numFaces: 1
  });

  console.log('[sensing] FaceLandmarker ready, requesting camera...');
  videoElement = document.getElementById('webcam');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: 640, height: 480 }
  });
  videoElement.srcObject = stream;
  await new Promise(r => { videoElement.onloadeddata = r; });
  console.log('[sensing] Camera stream active');

  // Set up debug preview
  const previewContainer = document.getElementById('debug-webcam-preview');
  if (previewContainer) {
    const previewVideo = document.createElement('video');
    previewVideo.srcObject = stream;
    previewVideo.autoplay = true;
    previewVideo.playsInline = true;
    previewVideo.muted = true;
    previewContainer.appendChild(previewVideo);
  }

  // Start detection loop
  let lastTime = -1;
  function detect() {
    if (videoElement.readyState >= 2) {
      const now = performance.now();
      if (now > lastTime) {
        lastTime = now;
        try {
          const result = faceLandmarker.detectForVideo(videoElement, now);

          if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
            const shapes = {};
            for (const cat of result.faceBlendshapes[0].categories) {
              shapes[cat.categoryName] = cat.score;
            }
            latestBlendShapes = shapes;
            faceDetected = true;

            if (result.facialTransformationMatrixes && result.facialTransformationMatrixes.length > 0) {
              latestHeadMatrix = result.facialTransformationMatrixes[0];
            }

            if (onUpdateCallback) onUpdateCallback(shapes);
          } else {
            faceDetected = false;
          }
        } catch (e) {
          // Silently handle detection errors (e.g., tab not visible)
        }
      }
    }
    requestAnimationFrame(detect);
  }

  requestAnimationFrame(detect);
  console.log('[sensing] Detection loop started');
}
