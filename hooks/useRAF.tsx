/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useCallback, useEffect, useRef } from "react";

const useRAF = (callback: (timestamp: number) => void, dependencies: any[] = []) => {
  const requestRef = useRef<number>(0);

  const lastTimeRef = useRef<number>(performance.now());
  const currentTimeRef = useRef<number>(performance.now());
  const fps = 60; // Desired FPS
  const interval = Math.floor(1000 / fps); 

  const animate = useCallback((timestamp: number) => {
    currentTimeRef.current = timestamp
    requestRef.current = requestAnimationFrame(animate);

    const deltaTime = currentTimeRef.current - lastTimeRef.current;
    if (deltaTime >= interval) {
      lastTimeRef.current = currentTimeRef.current - (deltaTime % interval);

      callback(timestamp);
    }
  }, dependencies);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [animate]);

  return requestRef;
};

export default useRAF;