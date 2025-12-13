# Animation Patterns

Framer Motion integration patterns for creating smooth, performant animations in React components.

## Basic Animation Patterns

### Fade In Animation
```typescript
import { motion } from "framer-motion"

export function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.25, 0.1, 0.25, 1],
      }}
    >
      {children}
    </motion.div>
  )
}
```

### Stagger Children Animation
```typescript
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
}

export function StaggerList({ items }: { items: string[] }) {
  return (
    <motion.ul
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-2"
    >
      {items.map((text, i) => (
        <motion.li
          key={i}
          variants={item}
          className="p-4 bg-secondary rounded-lg"
        >
          {text}
        </motion.li>
      ))}
    </motion.ul>
  )
}
```

## Page Transitions

### Route Transition Wrapper
```typescript
import { motion, AnimatePresence } from "framer-motion"
import { useLocation } from "react-router-dom"

const pageVariants = {
  initial: {
    opacity: 0,
    x: "-100vw",
  },
  in: {
    opacity: 1,
    x: 0,
  },
  out: {
    opacity: 0,
    x: "100vw",
  },
}

const pageTransition = {
  type: "tween",
  ease: "anticipate",
  duration: 0.5,
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial="initial"
        animate="in"
        exit="out"
        variants={pageVariants}
        transition={pageTransition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
```

## Gesture Animations

### Draggable Card
```typescript
export function DraggableCard() {
  return (
    <motion.div
      drag
      dragConstraints={{
        top: -50,
        left: -50,
        right: 50,
        bottom: 50,
      }}
      dragElastic={0.2}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      whileDrag={{ scale: 1.1 }}
      className="w-64 h-40 bg-gradient-to-br from-primary to-secondary rounded-lg shadow-lg cursor-move flex items-center justify-center text-white font-semibold"
    >
      Drag me around!
    </motion.div>
  )
}
```

### Hover Effects
```typescript
export function HoverCard() {
  return (
    <motion.div
      className="relative p-6 bg-card rounded-lg shadow-md cursor-pointer"
      whileHover={{ scale: 1.02 }}
      transition={{ type: "spring", stiffness: 300 }}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-primary to-secondary rounded-lg"
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 0.1 }}
        transition={{ duration: 0.3 }}
      />
      <h3 className="text-lg font-semibold">Interactive Card</h3>
      <p className="text-muted-foreground">Hover to see the effect</p>
    </motion.div>
  )
}
```

## Scroll-Based Animations

### Scroll Reveal
```typescript
import { useInView } from "framer-motion"
import { useRef } from "react"

export function ScrollReveal({ children }: { children: React.ReactNode }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.3 })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 50 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}
```

### Parallax Scrolling
```typescript
import { useScroll, useTransform } from "framer-motion"

export function ParallaxSection() {
  const { scrollYProgress } = useScroll()
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"])
  const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [1, 0.5, 0])

  return (
    <div className="relative h-screen overflow-hidden">
      <motion.div
        className="absolute inset-0 bg-gradient-to-b from-primary to-secondary"
        style={{ y, opacity }}
      />
      <div className="relative z-10 flex items-center justify-center h-full">
        <h1 className="text-6xl font-bold text-white">Parallax Effect</h1>
      </div>
    </div>
  )
}
```

## Complex Animations

### Morphing SVG
```typescript
export function MorphingSVG() {
  const [isOpen, setIsOpen] = useState(false)

  const pathVariants = {
    closed: {
      d: "M 2 2.5 L 20 2.5",
    },
    open: {
      d: "M 3 16.5 L 17 2.5",
    },
  }

  return (
    <button
      onClick={() => setIsOpen(!isOpen)}
      className="p-2 rounded-lg hover:bg-accent"
    >
      <svg width="24" height="24">
        <motion.path
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          animate={isOpen ? "open" : "closed"}
          variants={pathVariants}
        />
        <motion.path
          d="M 2 9.423 L 20 9.423"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          animate={{
            opacity: isOpen ? 0 : 1,
          }}
        />
        <motion.path
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          animate={isOpen ? {
            d: "M 3 2.5 L 17 16.5",
          } : {
            d: "M 2 16.346 L 20 16.346",
          }}
        />
      </svg>
    </button>
  )
}
```

### Animated Counter
```typescript
import { animate, useMotionValue, useTransform } from "framer-motion"
import { useEffect } from "react"

export function AnimatedCounter({ value }: { value: number }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, Math.round)

  useEffect(() => {
    const animation = animate(count, value, {
      duration: 2,
      ease: "easeOut",
    })

    return animation.stop
  }, [value])

  return (
    <motion.span className="text-4xl font-bold tabular-nums">
      {rounded}
    </motion.span>
  )
}
```

### Notification Stack
```typescript
export function NotificationStack() {
  const [notifications, setNotifications] = useState<string[]>([])

  const addNotification = (message: string) => {
    setNotifications((prev) => [...prev, message])
    setTimeout(() => {
      setNotifications((prev) => prev.slice(1))
    }, 3000)
  }

  return (
    <div className="fixed bottom-4 right-4 space-y-2">
      <AnimatePresence>
        {notifications.map((message, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 100, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg"
          >
            {message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
```

## Loading Animations

### Skeleton Pulse
```typescript
export function SkeletonPulse() {
  return (
    <motion.div
      className="h-4 bg-muted rounded"
      animate={{
        opacity: [0.5, 1, 0.5],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  )
}
```

### Spinner
```typescript
export function Spinner() {
  return (
    <motion.div
      className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full"
      animate={{ rotate: 360 }}
      transition={{
        duration: 1,
        repeat: Infinity,
        ease: "linear",
      }}
    />
  )
}
```

### Progress Bar
```typescript
export function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <motion.div
        className="h-full bg-primary"
        initial={{ width: "0%" }}
        animate={{ width: `${progress}%` }}
        transition={{
          duration: 0.5,
          ease: "easeOut",
        }}
      />
    </div>
  )
}
```

## Micro-interactions

### Button Press Effect
```typescript
export function PressButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 10 }}
      className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium"
    >
      {children}
    </motion.button>
  )
}
```

### Toggle Switch Animation
```typescript
export function AnimatedSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted"
      )}
    >
      <motion.span
        className="inline-block h-4 w-4 transform rounded-full bg-white shadow-lg"
        animate={{
          x: checked ? 24 : 2,
        }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 30,
        }}
      />
    </button>
  )
}
```

### Confetti Burst
```typescript
export function ConfettiBurst() {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number }>>([])

  const burst = () => {
    const newParticles = Array.from({ length: 20 }, (_, i) => ({
      id: Date.now() + i,
      x: Math.random() * 200 - 100,
      y: Math.random() * -200 - 50,
    }))
    setParticles(newParticles)
    setTimeout(() => setParticles([]), 1000)
  }

  return (
    <div className="relative">
      <button onClick={burst} className="px-4 py-2 bg-primary text-primary-foreground rounded">
        Click for confetti!
      </button>
      <AnimatePresence>
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="absolute w-2 h-2 bg-gradient-to-r from-pink-500 to-yellow-500 rounded-full"
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{
              x: particle.x,
              y: particle.y,
              opacity: 0,
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 1,
              ease: "easeOut",
            }}
            style={{ left: "50%", top: "50%" }}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
```

## Layout Animations

### Shared Layout
```typescript
export function TabsWithIndicator() {
  const [activeTab, setActiveTab] = useState(0)
  const tabs = ["Home", "About", "Contact"]

  return (
    <div className="flex gap-2 relative">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          onClick={() => setActiveTab(index)}
          className="relative px-4 py-2 text-sm font-medium transition-colors"
        >
          {activeTab === index && (
            <motion.div
              layoutId="activeTab"
              className="absolute inset-0 bg-primary rounded-lg"
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            />
          )}
          <span className={cn(
            "relative z-10",
            activeTab === index ? "text-primary-foreground" : "text-muted-foreground"
          )}>
            {tab}
          </span>
        </button>
      ))}
    </div>
  )
}
```