/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useState, useCallback } from "react";
import GameCanvas from "./components/GameCanvas";
import { GameStatus } from "./types";
import { COLORS, GAME_CONFIG } from "./constants";
import useMicrophonePermission from "./hooks/useMicrophonePermission"
import InfoDialog from './components/InfoDialog.tsx'

const App: React.FC = () => {
  const [status, setStatus] = useState<GameStatus>(GameStatus.IDLE);
  const [lastProgress, setLastProgress] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [godMode, setGodmode] = useState(false);
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [micConfirmed, setMicConfirmed] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const microphonePermissions = useMicrophonePermission();
  const startGameOnLateMicGranted = false;
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [isGracePeriod, setIsGracePeriod] = useState(false);
  const [isMicSimulated, setIsMicSimulated] = useState(false);
  const isDeveloperMode = GAME_CONFIG.DEV_ENABLED;

  const startGame = useCallback(async () => {
    if (status === GameStatus.PLAYING) return;

    setIsRequestingMic(true);
    setStatus(GameStatus.PREPARING);
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStream(stream);
      setIsMicSimulated(false);
      
      // START GRACE PERIOD
      setIsGracePeriod(true);
      setStatus(GameStatus.PLAYING);
      setLastProgress(0);

      // End grace period after 3 seconds
      setTimeout(() => {
        setIsGracePeriod(false);
      }, 3000);

    } catch (err) {
      console.error("Microphone access denied:", err);
      // Fallback to simulation mode if mic is denied
      setMicStream(null);
      setIsMicSimulated(true);

      // Start the game in simulation mode
      setIsGracePeriod(true);
      setStatus(GameStatus.PLAYING);
      setLastProgress(0);

      setTimeout(() => {
        setIsGracePeriod(false);
      }, 3000);
    } finally {
      setIsRequestingMic(false);
    }
  }, [status]);


  const handleGameOver = useCallback(
    (distanceInPixels: number) => {
      const score = Math.round(distanceInPixels * GAME_CONFIG.SCORE_MULTIPLIER);
      setFinalScore(score);
      setStatus(GameStatus.GAMEOVER);
      setLastProgress(distanceInPixels);
    },
    []
  );

  const handleWin = useCallback(
    (distanceInPixels: number) => {
      const score = Math.round(distanceInPixels * GAME_CONFIG.SCORE_MULTIPLIER);
      setFinalScore(score);
      setStatus(GameStatus.WON);
      setLastProgress(distanceInPixels);
    },
    []
  );

  useEffect(() => {
    const onStart = (e: Event) => {
      startGame();
    };

    window.addEventListener("build:start", onStart);
    return () => window.removeEventListener("build:start", onStart);
  }, [startGame]);

  useEffect(() => {
    if (status === GameStatus.IDLE && startGameOnLateMicGranted && microphonePermissions.granted) {
      startGame();
    }
    
    else if (status === GameStatus.PLAYING) {
      const trulyLostAccess = !micStream && !microphonePermissions.granted;

      // Do not pause if we are in simulated mode
      if (trulyLostAccess && !isRequestingMic && !isMicSimulated) {
        console.log("Mic truly lost, pausing.");
        setStatus(GameStatus.PAUSED);
      }
    }
  }, [
    status, 
    microphonePermissions.granted, 
    micStream,
    isRequestingMic, 
    startGameOnLateMicGranted, 
    startGame,
    isMicSimulated,
  ]);

  return (
    <>
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: `linear-gradient(to bottom, ${COLORS.BG_TOP}, ${COLORS.BG_BOTTOM})` }}
    >
      <GameCanvas 
        micStream={micStream} 
        status={status} 
        onGameOver={handleGameOver} 
        onWin={handleWin} 
        godMode={godMode}
        isMicSimulated={isMicSimulated}
      />

      {(isDeveloperMode) && (
        <div className="absolute left-0 top-0">
          <button
            onClick={() => setGodmode(!godMode)}
            className="px-10 py-4 rounded-full bg-white text-black font-black text-xl shadow-lg hover:shadow-xl hover:bg-gray-100 active:scale-95 transition-all"
            title="Set God Mode"
            style={godMode?{
                background: "white"
              }:{
                background: "grey"
              }}
          >
            {godMode?"god mode":"god mode"}
          </button>
        </div>
      )}

      {micError && (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300 z-50">
          <div className="bg-white p-12 rounded-[20px] shadow-2xl flex flex-col items-center w-full max-w-md text-center border text-white rainbow-border-2 [--gradient-angle:270deg] text-[18px]">
            
            <div className="py-10">
              <p className="font-medium tracking-tight leading-none mb-2">Could not find mic</p>
              <p className="font-medium tracking-tight leading-none mb-2">Allow mic permissions and try again</p>
              <p>{micError}</p>
            </div>

            <button
              onClick={() => {
                startGame();
              }}
              className="flex justify-center py-5 w-[220px] md:w-[259px] cursor-pointer bg-white text-black rounded-[120px] transition-[filter] duration-200 focus-overflow hover:brightness-110 ease-out will-change-[filter] mb-[22px]"
            >
              Play
            </button>
          </div>
        </div>
      )}

      {status === GameStatus.GAMEOVER && (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300 z-50">
          <div className="bg-white p-12 rounded-[20px] shadow-2xl flex flex-col items-center w-full max-w-md text-center border text-white rainbow-border-2 [--gradient-angle:270deg] text-[18px]">
            <h2 className="text-5xl font-medium tracking-tight">Game over</h2>
            
            <div className="py-10">
              <p className="text-[96px] font-medium tracking-tight leading-none mb-2">{finalScore.toLocaleString()}</p>
              <p className="text-[#9BA0A6] text-lg tracking-tight font-medium leading-none">Points</p>
            </div>

            <button
              onClick={() => {
                startGame();
              }}
              className="flex justify-center py-5 w-[220px] md:w-[259px] cursor-pointer bg-white text-black rounded-[120px] transition-[filter] duration-200 focus-overflow hover:brightness-110 ease-out will-change-[filter] mb-[22px]"
            >
              Play again
            </button>
            {micError&&(
              <p className="mt-4">
              {micError}
              </p>
            )}
          </div>
        </div>
      )}

      {status === GameStatus.WON && (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300 z-50">
          <div className="bg-white p-12 rounded-[20px] shadow-2xl flex flex-col items-center w-full max-w-md text-center border text-white rainbow-border-2 [--gradient-angle:270deg] text-[18px]">
            <h2 className="text-5xl font-medium tracking-tight">Congratulations!</h2>
            
            <div className="py-10">
              <p className="text-[96px] font-medium tracking-tight leading-none mb-2">{finalScore.toLocaleString()}</p>
              <p className="text-[#9BA0A6] text-lg tracking-tight font-medium leading-none">Points</p>
            </div>

            <button
              onClick={() => {
                startGame();
              }}
              className="flex justify-center py-5 w-[220px] md:w-[259px] cursor-pointer bg-white text-black rounded-[120px] transition-[filter] duration-200 focus-overflow hover:brightness-110 ease-out will-change-[filter] mb-[22px]"
            >
              Play again
            </button>
            {micError&&(
              <p className="mt-4">
              {micError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
    <InfoDialog title="Fly with your voice" goal="Help the Android Bot reach safety by controlling its flight by the volume of your voice." goalNote="Requires microphone access" onClose={() => {
      if (status === GameStatus.IDLE) {
        startGame();
      }
    }}/>
    </>
  );
};

export default App;