precision mediump float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uMultiHazardMap; // RGBA data texture mapped to SharedArrayBuffer
uniform float uTime;
uniform int uActiveLens; // 0: Physical, 1: Cyber, 2: Economic

void main(void) {
    vec4 baseColor = texture2D(uSampler, vTextureCoord);
    vec4 hazardData = texture2D(uMultiHazardMap, vTextureCoord);
    
    float severity = 0.0;
    vec3 brutalColor = vec3(0.0);
    
    // Physical/War Lens (Harsh Red)
    if (uActiveLens == 0) {
        severity = hazardData.r;
        brutalColor = vec3(1.0, 0.0, 0.0);
    } 
    // Cyber Blackout Lens (Terminal Phosphor Green)
    else if (uActiveLens == 1) {
        severity = hazardData.g;
        brutalColor = vec3(0.0, 1.0, 0.1);
        
        // CRT static distortion for cyber events
        if (severity > 0.5) {
            float staticNoise = fract(sin(dot(vTextureCoord * uTime, vec2(12.9898, 78.233))) * 43758.5453);
            baseColor.rgb *= staticNoise; 
        }
    } 
    // Economic Sanction Lens (Desaturated Yellow/Gold)
    else if (uActiveLens == 2) {
        severity = hazardData.b;
        brutalColor = vec3(1.0, 0.8, 0.0);
    }

    if (severity > 0.05) {
        // Strict scanline banding (Brutalist rendering, no gradients)
        float scanline = step(0.5, fract(vTextureCoord.y * 1000.0));
        vec3 finalColor = mix(baseColor.rgb, brutalColor, scanline * severity);
        gl_FragColor = vec4(finalColor, baseColor.a);
    } else {
        gl_FragColor = baseColor;
    }
}