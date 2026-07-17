import React, { useState, useRef, useEffect, useCallback } from "react";

// ----- Constantes de campo -----
const FIELD_W = 300;
const FIELD_H = 460;
const GOAL_W = 140;
const PLAYER_R = 16;
const BALL_R = 9;
const GOAL_DEPTH = 14;
const WALL_RESTITUTION = 0.82; // energia mantida ao rebater na tabela
const SPIN_DECAY = 0.965; // decaimento do efeito (spin) por frame
const MAGNUS_FACTOR = 0.045; // o quanto o spin curva a trajetória

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export default function NeonFoosball() {
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState("ready"); // ready | playing | goal
  const [lastScorer, setLastScorer] = useState(null);
  // quem começa com a bola nessa rodada ("p1" ou "p2")
  const possessionRef = useRef("p1");

  // jogadores só se movem no eixo X (trilho horizontal), y fixo
  const p1 = useRef({ x: FIELD_W / 2, y: FIELD_H - 60 }); // embaixo, controlado por joystick
  const p2 = useRef({ x: FIELD_W / 2, y: 60 }); // em cima, IA
  const ball = useRef({ x: FIELD_W / 2, y: FIELD_H / 2, vx: 0, vy: 0, spin: 0 });

  // haste de chute: animação visual por jogador
  const kickAnimRef = useRef({
    p1: { active: false, dirX: 0, dirY: -1, t: 0 },
    p2: { active: false, dirX: 0, dirY: 1, t: 0 },
  });

  const [, forceRender] = useState(0);
  const rafRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // controle do joystick (jogador 1 - esquerdo, agora analógico: move em X e também avança em Y até o meio de campo)
  // dx e dy vão de -1 a 1, mapeados proporcionalmente ao raio real do joystick na tela
  const joyRef = useRef({ active: false, dx: 0, dy: 0 });
  const joyBaseRef = useRef(null);
  const joyElRef = useRef(null); // ref do elemento DOM do joystick, pra medir sua largura real

  // controle de chute direcional/carregável (botão direito)
  // aimX: -1 a 1 (mira lateral), power: 0 a 1 (força carregada), charging: segurando o dedo
  const kickCtrlRef = useRef({ charging: false, aimX: 0, power: 0 });
  const kickBaseRef = useRef(null);
  const kickElRef = useRef(null); // ref do elemento DOM do botão, pra medir sua largura real

  const resetBall = useCallback(() => {
    // a bola nasce colada no jogador que tem a posse, mas já sai rolando em direção ao centro
    const owner = possessionRef.current === "p1" ? p1.current : p2.current;
    const dirToCenter = owner.y > FIELD_H / 2 ? -1 : 1; // encosta a bola do lado de dentro do campo
    ball.current = {
      x: owner.x,
      y: owner.y + dirToCenter * (PLAYER_R + BALL_R + 2),
      vx: 0,
      vy: 0, // parada, esperando o primeiro chute de quem tem a posse
      spin: 0,
    };
  }, []);

  const resetPositions = useCallback(() => {
    p1.current = { x: FIELD_W / 2, y: FIELD_H - 60 };
    p2.current = { x: FIELD_W / 2, y: 60 };
    resetBall();
  }, [resetBall]);

  useEffect(() => {
    resetPositions();
    setPhase("playing");
  }, [resetPositions]);

  // Loop do jogo
  useEffect(() => {
    const step = () => {
      if (phaseRef.current === "playing") {
        const b = ball.current;

        // efeito magnus: spin curva a trajetória (perpendicular à velocidade)
        if (Math.abs(b.spin) > 0.001) {
          const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 0.001;
          const nx = -b.vy / speed;
          const ny = b.vx / speed;
          b.vx += nx * b.spin * MAGNUS_FACTOR;
          b.vy += ny * b.spin * MAGNUS_FACTOR;
          b.spin *= SPIN_DECAY;
        }

        // fricção geral
        b.vx *= 0.985;
        b.vy *= 0.985;

        b.x += b.vx;
        b.y += b.vy;

        // ----- TABELAS laterais (reflexão vetorial correta) -----
        if (b.x < BALL_R) {
          b.x = BALL_R;
          b.vx = -b.vx * WALL_RESTITUTION;
          b.spin *= 0.7;
        }
        if (b.x > FIELD_W - BALL_R) {
          b.x = FIELD_W - BALL_R;
          b.vx = -b.vx * WALL_RESTITUTION;
          b.spin *= 0.7;
        }

        // ----- gols (topo e base), com tabela ao redor do gol -----
        const inGoalX = b.x > FIELD_W / 2 - GOAL_W / 2 && b.x < FIELD_W / 2 + GOAL_W / 2;

        if (b.y < BALL_R) {
          if (inGoalX) {
            setScore((s) => ({ ...s, p1: s.p1 + 1 }));
            setLastScorer("p1");
            possessionRef.current = "p2"; // quem sofreu o gol sai com a bola
            setPhase("goal");
          } else {
            b.y = BALL_R;
            b.vy = -b.vy * WALL_RESTITUTION;
            b.spin *= 0.7;
          }
        }
        if (b.y > FIELD_H - BALL_R) {
          if (inGoalX) {
            setScore((s) => ({ ...s, p2: s.p2 + 1 }));
            setLastScorer("p2");
            possessionRef.current = "p1"; // quem sofreu o gol sai com a bola
            setPhase("goal");
          } else {
            b.y = FIELD_H - BALL_R;
            b.vy = -b.vy * WALL_RESTITUTION;
            b.spin *= 0.7;
          }
        }

        // colisão jogador-bola (empurra e transfere um pouco de efeito lateral)
        collide(p1.current, b, joyRef.current.dx);
        collide(p2.current, b, 0);

        // movimento do jogador 1 via joystick — agora analógico: X livre nos lados, Y avança até o meio de campo
        if (joyRef.current.active) {
          p1.current.x = clamp(p1.current.x + joyRef.current.dx * 4.5, PLAYER_R, FIELD_W - PLAYER_R);
          // Y só pode ir do fundo (FIELD_H - 60, posição base) até a linha do meio de campo (FIELD_H / 2)
          p1.current.y = clamp(p1.current.y + joyRef.current.dy * 4.5, FIELD_H / 2, FIELD_H - 60);
        }

        // IA do jogador 2 — também só eixo X
        const targetX = b.y < FIELD_H / 2 + 40 ? b.x : FIELD_W / 2;
        const dir = targetX - p2.current.x;
        p2.current.x = clamp(p2.current.x + clamp(dir, -2.6, 2.6), PLAYER_R, FIELD_W - PLAYER_R);
      }

      // carrega força do chute enquanto o botão estiver pressionado, e mantém a mira seguindo a bola
      if (kickCtrlRef.current.charging) {
        kickCtrlRef.current.power = clamp(kickCtrlRef.current.power + 0.045, 0, 1);
        updateChargingLeg();
      }

      // avança animações de haste de chute (só recolhe se não estiver "holding")
      ["p1", "p2"].forEach((k) => {
        const anim = kickAnimRef.current[k];
        if (anim.active && !anim.holding) {
          anim.t += 1;
          if (anim.t > 14) {
            anim.active = false;
            anim.t = 0;
          }
        }
      });

      forceRender((n) => n + 1);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // colisão com efeito lateral (spin) baseado no ponto de contato
  function collide(player, b, lateralInput) {
    const dx = b.x - player.x;
    const dy = b.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = PLAYER_R + BALL_R;
    if (dist < minDist && dist > 0) {
      const overlap = minDist - dist;
      const nx = dx / dist;
      const ny = dy / dist;
      b.x += nx * overlap;
      b.y += ny * overlap;
      b.vx += nx * 2.2;
      b.vy += ny * 2.2;
      b.spin += nx * 1.8 + lateralInput * 2.4;
    }
  }

  useEffect(() => {
    if (phase === "goal") {
      const t = setTimeout(() => {
        setRound((r) => r + 1);
        resetPositions();
        setPhase("playing");
      }, 1400);
      return () => clearTimeout(t);
    }
  }, [phase, resetPositions]);

  // ---- Handlers de joystick (P1) — agora analógico em X e Y, proporcional ao raio do próprio manípulo ----
  const onJoyStart = (e) => {
    joyRef.current.active = true;
    joyBaseRef.current = getPoint(e);
  };
  const onJoyMove = (e) => {
    if (!joyRef.current.active || !joyBaseRef.current) return;
    const pt = getPoint(e);
    const dx = pt.x - joyBaseRef.current.x;
    const dy = pt.y - joyBaseRef.current.y;
    // raio de curso do manípulo: quanto mais perto do fim, mais rápido, de forma contínua
    const joyRadius = 40;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(dist, joyRadius);
    const norm = dist > 0 ? clampedDist / dist : 0;
    joyRef.current.dx = clamp((dx * norm) / joyRadius, -1, 1);
    // dy negativo (arrastar pra cima) = avançar em direção ao meio de campo
    joyRef.current.dy = clamp((dy * norm) / joyRadius, -1, 1);
  };
  const onJoyEnd = () => {
    joyRef.current.active = false;
    joyRef.current.dx = 0;
    joyRef.current.dy = 0;
  };
  function getPoint(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  // ---- Controle de CHUTE: arrastar mira lateralmente, segurar carrega força, soltar dispara ----
  const onKickStart = (e) => {
    if (phaseRef.current !== "playing") return;
    kickCtrlRef.current.charging = true;
    kickCtrlRef.current.aimX = 0;
    kickCtrlRef.current.power = 0;
    kickBaseRef.current = getPoint(e);
    // trava a haste esticada na direção da bola assim que começa a segurar
    updateChargingLeg();
  };

  const onKickMove = (e) => {
    if (!kickCtrlRef.current.charging || !kickBaseRef.current) return;
    const pt = getPoint(e);
    const dx = pt.x - kickBaseRef.current.x;
    const aimRadius = 42; // curso lateral do botão pra mirar
    kickCtrlRef.current.aimX = clamp(dx / aimRadius, -1, 1);
    updateChargingLeg();
  };

  const onKickEnd = () => {
    if (!kickCtrlRef.current.charging) return;
    fireKick("p1");
    kickCtrlRef.current.charging = false;
    kickCtrlRef.current.aimX = 0;
    kickCtrlRef.current.power = 0;
  };

  // enquanto segura, a haste fica esticada e visível (não recolhe sozinha)
  function updateChargingLeg() {
    const player = p1.current;
    const b = ball.current;
    const dx = b.x - player.x + kickCtrlRef.current.aimX * 30;
    const dy = b.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    kickAnimRef.current.p1 = {
      active: true,
      dirX: dx / dist,
      dirY: -Math.abs(dy) / dist || -1,
      t: 7, // trava no pico da animação (totalmente esticada) enquanto segura
      holding: true,
    };
  }

  // Chute: dispara a haste visual + aplica força/efeito na bola, com força proporcional ao tempo/carga
  const fireKick = (who) => {
    if (phaseRef.current !== "playing") return;
    const player = who === "p1" ? p1.current : p2.current;
    const b = ball.current;
    const aimX = who === "p1" ? kickCtrlRef.current.aimX : 0;
    const dx = b.x - player.x + aimX * 30;
    const dy = b.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const kickRange = PLAYER_R + BALL_R + 34;

    const dirX = dist > 0 ? dx / dist : 0;
    const dirY = who === "p1" ? -1 : 1;

    // dispara a animação de recolhimento (holding: false = ela recolhe normalmente agora)
    kickAnimRef.current[who] = { active: true, dirX, dirY, t: 0, holding: false };

    if (dist < kickRange) {
      // força proporcional à carga: mínimo garantido + bônus pela força empregada
      const chargePower = who === "p1" ? 0.4 + kickCtrlRef.current.power * 0.6 : 1;
      const power = 9.5 * chargePower;
      const lateralOffset = clamp(dx / kickRange, -1, 1);
      b.vx += (dx / dist) * power * 0.5;
      b.vy += dirY * power;
      b.spin += lateralOffset * 3.2;
    }
  };

  const scale = "min(92vw, 340px)";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 0%, #0d1120 0%, #05060d 65%, #000 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "18px 12px 28px",
        fontFamily: "'Orbitron', 'Segoe UI', sans-serif",
        color: "#e8f6ff",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@500;600;700&display=swap');
        * { box-sizing: border-box; }
        .neon-text { font-family: 'Orbitron', sans-serif; }
        .mono-label { font-family: 'Rajdhani', sans-serif; letter-spacing: 1.5px; }
      `}</style>

      <div style={{ width: scale, display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <ScoreCard label="JOGADOR 1" value={score.p1} color="#ff5ec4" align="left" />
        <ScoreCard label="JOGADOR 2" value={score.p2} color="#3ee1ff" align="right" />
      </div>

      <div className="mono-label" style={{ fontSize: 12, opacity: 0.65, marginBottom: 8, letterSpacing: 2 }}>
        RODADA {round}
      </div>

      <div
        style={{
          position: "relative",
          width: scale,
          aspectRatio: `${FIELD_W} / ${FIELD_H}`,
          background: "repeating-linear-gradient(180deg, #070b16 0px, #070b16 22px, #0a0f1e 22px, #0a0f1e 44px)",
          border: "2px solid #1c3a52",
          borderRadius: 14,
          boxShadow: "0 0 30px rgba(62,225,255,0.15), inset 0 0 40px rgba(62,225,255,0.06)",
          overflow: "hidden",
        }}
      >
        <FieldSVG />

        <Dot x={ball.current.x} y={ball.current.y} size={BALL_R * 2} glow="#ffb84d" emoji="⚽" />

        <KickLeg player={p1.current} anim={kickAnimRef.current.p1} color="#ff5ec4" />
        <Dot x={p1.current.x} y={p1.current.y} size={PLAYER_R * 2} glow="#ff5ec4" ring />

        <KickLeg player={p2.current} anim={kickAnimRef.current.p2} color="#3ee1ff" />
        <Dot x={p2.current.x} y={p2.current.y} size={PLAYER_R * 2} glow="#3ee1ff" ring />

        {phase === "goal" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              className="neon-text"
              style={{
                fontSize: 30,
                fontWeight: 900,
                color: lastScorer === "p1" ? "#ff5ec4" : "#3ee1ff",
                textShadow: `0 0 18px ${lastScorer === "p1" ? "#ff5ec4" : "#3ee1ff"}`,
              }}
            >
              GOL!
            </div>
          </div>
        )}
      </div>

      <div style={{ width: scale, display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22 }}>
        <div
          onMouseDown={onJoyStart}
          onMouseMove={onJoyMove}
          onMouseUp={onJoyEnd}
          onMouseLeave={onJoyEnd}
          onTouchStart={onJoyStart}
          onTouchMove={onJoyMove}
          onTouchEnd={onJoyEnd}
          style={{
            width: 90,
            height: 90,
            borderRadius: "50%",
            border: "2px solid #3ee1ff",
            background: "rgba(62,225,255,0.08)",
            boxShadow: "0 0 14px rgba(62,225,255,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            touchAction: "none",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "#3ee1ff",
              boxShadow: "0 0 12px #3ee1ff",
              transform: `translate(${joyRef.current.dx * 30}px, ${joyRef.current.dy * 30}px)`,
              transition: joyRef.current.active ? "none" : "transform 0.15s ease",
            }}
          />
        </div>

        <div
          onMouseDown={onKickStart}
          onMouseMove={onKickMove}
          onMouseUp={onKickEnd}
          onMouseLeave={onKickEnd}
          onTouchStart={(e) => {
            e.preventDefault();
            onKickStart(e);
          }}
          onTouchMove={(e) => {
            e.preventDefault();
            onKickMove(e);
          }}
          onTouchEnd={onKickEnd}
          className="neon-text"
          style={{
            width: 84,
            height: 84,
            borderRadius: "50%",
            border: "2px solid #ff5ec4",
            background: `rgba(255,94,196,${0.1 + kickCtrlRef.current.power * 0.25})`,
            color: "#ff5ec4",
            fontWeight: 700,
            fontSize: 13,
            boxShadow: `0 0 ${18 + kickCtrlRef.current.power * 22}px rgba(255,94,196,${0.45 + kickCtrlRef.current.power * 0.3})`,
            letterSpacing: 1,
            touchAction: "none",
            position: "relative",
            zIndex: 10,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            userSelect: "none",
            transform: `scale(${1 + kickCtrlRef.current.power * 0.08})`,
          }}
        >
          {kickCtrlRef.current.charging ? "SOLTE" : "CHUTE"}
        </div>
      </div>

      <div className="mono-label" style={{ marginTop: 16, fontSize: 12, opacity: 0.55, textAlign: "center", maxWidth: scale }}>
        JOYSTICK ANALÓGICO: ARRASTE PROS LADOS E PRA FRENTE ATÉ O MEIO · SEGURE CHUTE E ARRASTE PRA MIRAR, SOLTE PRA CHUTAR
      </div>
    </div>
  );
}

function ScoreCard({ label, value, color, align }) {
  return (
    <div
      style={{
        flex: 1,
        border: `1px solid ${color}`,
        borderRadius: 10,
        padding: "8px 10px",
        background: `linear-gradient(180deg, ${color}14, transparent)`,
        boxShadow: `0 0 14px ${color}33`,
        textAlign: align,
      }}
    >
      <div className="mono-label" style={{ fontSize: 10, opacity: 0.75, color }}>
        {label}
      </div>
      <div className="neon-text" style={{ fontSize: 26, fontWeight: 900, color, textShadow: `0 0 10px ${color}` }}>
        {value}
      </div>
    </div>
  );
}

function Dot({ x, y, size, glow, emoji, ring }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${(x / FIELD_W) * 100}%`,
        top: `${(y / FIELD_H) * 100}%`,
        width: size,
        height: size,
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        background: ring ? `radial-gradient(circle, ${glow}55, ${glow}22)` : "#fff",
        border: ring ? `2px solid ${glow}` : "1px solid #ffb84d",
        boxShadow: `0 0 12px ${glow}, 0 0 4px ${glow}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: emoji ? size * 0.75 : 0,
        zIndex: 3,
      }}
    >
      {emoji}
    </div>
  );
}

// Haste/perna que sai do robô na direção da bola durante o chute
function KickLeg({ player, anim, color }) {
  if (!anim.active) return null;
  const half = 7;
  const t = anim.t <= half ? anim.t / half : 1 - (anim.t - half) / half;
  const progress = clamp(t, 0, 1);
  const length = 26 * progress;

  // ângulo fixo na direção da bola — sem giro/oscilação extra, pra ficar estável e não "balançar"
  const baseAngle = Math.atan2(anim.dirY, anim.dirX);
  const angle = baseAngle;

  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  const endX = player.x + dirX * (PLAYER_R + length);
  const endY = player.y + dirY * (PLAYER_R + length);

  // travessão em T na ponta: maior e curvado, tipo pá/raquete de pebolim de verdade
  const tHalf = 15 * Math.max(progress, 0.55); // T já nasce grande e cresce até o pico
  const curve = 5 * progress; // curvatura: a pá arqueia pra frente no meio
  const perpX = -dirY * tHalf;
  const perpY = dirX * tHalf;
  const tX1 = endX - perpX;
  const tY1 = endY - perpY;
  const tX2 = endX + perpX;
  const tY2 = endY + perpY;
  // ponto de controle da curva, puxado na direção do chute (arco da pá)
  const curveX = endX + dirX * curve;
  const curveY = endY + dirY * curve;

  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 2, pointerEvents: "none" }}
      viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
    >
      {/* haste grossa e firme */}
      <line
        x1={player.x}
        y1={player.y}
        x2={endX}
        y2={endY}
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        opacity={0.92}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
      {/* pá em T na ponta: curvada, maior e mais estável */}
      <path
        d={`M ${tX1} ${tY1} Q ${curveX} ${curveY} ${tX2} ${tY2}`}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        opacity={0.95}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </svg>
  );
}

function FieldSVG() {
  return (
    <svg viewBox={`0 0 ${FIELD_W} ${FIELD_H}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <line x1="0" y1={FIELD_H / 2} x2={FIELD_W} y2={FIELD_H / 2} stroke="#2a5570" strokeWidth="1.5" />
      <circle cx={FIELD_W / 2} cy={FIELD_H / 2} r="34" fill="none" stroke="#2a5570" strokeWidth="1.5" />
      <circle cx={FIELD_W / 2} cy={FIELD_H / 2} r="3" fill="#2a5570" />

      <rect x={FIELD_W / 2 - GOAL_W / 2} y={0} width={GOAL_W} height={GOAL_DEPTH} fill="none" stroke="#3ee1ff" strokeWidth="2" />
      <rect x={FIELD_W / 2 - GOAL_W / 2} y={FIELD_H - GOAL_DEPTH} width={GOAL_W} height={GOAL_DEPTH} fill="none" stroke="#ff5ec4" strokeWidth="2" />

      <rect x={FIELD_W / 2 - GOAL_W / 2 - 22} y={0} width={GOAL_W + 44} height={70} fill="none" stroke="#1c3a52" strokeWidth="1.2" />
      <rect x={FIELD_W / 2 - GOAL_W / 2 - 22} y={FIELD_H - 70} width={GOAL_W + 44} height={70} fill="none" stroke="#1c3a52" strokeWidth="1.2" />
    </svg>
  );
}
