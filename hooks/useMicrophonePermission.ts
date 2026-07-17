/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useState, useEffect } from 'react';

export default function useMicrophonePermission() {
  const [permissionStatus, setPermissionStatus] = useState('prompt');

  useEffect(() => {
    let permissionStatusHandler: PermissionStatus | null = null;
    let mounted = true;

    const checkPermission = async () => {
      // 1. Try checking media devices directly (fallback for browsers where Permissions API is restricted/unsupported for 'microphone')
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (devices.some(device => device.kind === 'audioinput' && device.label !== '') && mounted) {
            setPermissionStatus('granted');
          }
        }
      } catch (e) {
        console.warn('Error enumerating devices:', e);
      }

      // 2. Try Permissions API (if available)
      if (navigator.permissions && navigator.permissions.query) {
        try {
          // 'microphone' as PermissionName cast is often needed for TS compatibility
          permissionStatusHandler = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          
          if (mounted) {
            setPermissionStatus(permissionStatusHandler.state);
          }

          // Listen for changes in the permission status
          permissionStatusHandler.onchange = () => {
            if (mounted && permissionStatusHandler) {
              setPermissionStatus(permissionStatusHandler.state);
            }
          };
        } catch (error) {
          // Permissions API might fail on Safari/Firefox for 'microphone'
          // We rely on the enumerateDevices check above in that case
          console.debug('Permissions API check failed:', error);
        }
      }
    };

    checkPermission();

    // Cleanup the event listener on component unmount
    return () => {
      mounted = false;
      if (permissionStatusHandler) {
        permissionStatusHandler.onchange = null;
      }
    };
  }, []); // Empty dependency array ensures this runs once when the component mounts

  return { granted: permissionStatus === "granted", prompting: permissionStatus === "prompt" };
};
