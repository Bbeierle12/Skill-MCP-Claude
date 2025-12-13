# Component Testing Patterns

Comprehensive testing patterns for React components using Jest, React Testing Library, and Storybook.

## Testing Setup

### Jest Configuration
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.tsx',
    '!src/test/**',
  ],
  testMatch: [
    '**/__tests__/**/*.{ts,tsx}',
    '**/?(*.)+(spec|test).{ts,tsx}',
  ],
}
```

### Test Setup File
```typescript
// src/test/setup.ts
import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords() {
    return []
  }
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})
```

## Basic Component Testing

### Button Component Test
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders with text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })

  it('handles click events', async () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Click me</Button>)
    
    const button = screen.getByRole('button')
    await userEvent.click(button)
    
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('applies variant styles', () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>)
    const button = screen.getByRole('button')
    
    expect(button).toHaveClass('bg-destructive')
    
    rerender(<Button variant="outline">Cancel</Button>)
    expect(button).toHaveClass('border')
  })

  it('can be disabled', () => {
    render(<Button disabled>Disabled</Button>)
    const button = screen.getByRole('button')
    
    expect(button).toBeDisabled()
    expect(button).toHaveClass('disabled:opacity-50')
  })

  it('renders as child component when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/link">Link Button</a>
      </Button>
    )
    
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/link')
    expect(link).toHaveTextContent('Link Button')
  })
})
```

### Form Component Test
```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { Form, FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

function TestForm({ onSubmit }: { onSubmit: (data: any) => void }) {
  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
    },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="email"
          rules={{ required: 'Email is required' }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} type="email" />
              </FormControl>
            </FormItem>
          )}
        />
        <button type="submit">Submit</button>
      </form>
    </Form>
  )
}

describe('Form', () => {
  it('submits form with valid data', async () => {
    const handleSubmit = jest.fn()
    const user = userEvent.setup()
    
    render(<TestForm onSubmit={handleSubmit} />)
    
    const emailInput = screen.getByLabelText(/email/i)
    const submitButton = screen.getByRole('button', { name: /submit/i })
    
    await user.type(emailInput, 'test@example.com')
    await user.click(submitButton)
    
    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: '',
      })
    })
  })

  it('shows validation errors', async () => {
    const handleSubmit = jest.fn()
    const user = userEvent.setup()
    
    render(<TestForm onSubmit={handleSubmit} />)
    
    const submitButton = screen.getByRole('button', { name: /submit/i })
    await user.click(submitButton)
    
    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument()
    })
    
    expect(handleSubmit).not.toHaveBeenCalled()
  })
})
```

## Testing Async Components

### Data Fetching Component
```typescript
import { render, screen, waitFor } from '@testing-library/react'
import { rest } from 'msw'
import { setupServer } from 'msw/node'
import { DataTable } from '@/components/ui/data-table'

const server = setupServer(
  rest.get('/api/users', (req, res, ctx) => {
    return res(
      ctx.json([
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
      ])
    )
  })
)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('DataTable with async data', () => {
  it('loads and displays data', async () => {
    render(<DataTable endpoint="/api/users" />)
    
    // Initially shows loading state
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
    
    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    })
    
    // Loading state should be gone
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument()
  })

  it('handles error state', async () => {
    server.use(
      rest.get('/api/users', (req, res, ctx) => {
        return res(ctx.status(500))
      })
    )
    
    render(<DataTable endpoint="/api/users" />)
    
    await waitFor(() => {
      expect(screen.getByText(/error loading data/i)).toBeInTheDocument()
    })
  })
})
```

## Testing Accessibility

### ARIA and Keyboard Navigation
```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { Dialog } from '@/components/ui/dialog'

expect.extend(toHaveNoViolations)

describe('Dialog Accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accessible Dialog</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            This dialog should be accessible
          </DialogDescription>
        </DialogContent>
      </Dialog>
    )
    
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('traps focus within dialog', async () => {
    const user = userEvent.setup()
    
    render(
      <Dialog open>
        <DialogContent>
          <button>First button</button>
          <button>Second button</button>
          <button>Third button</button>
        </DialogContent>
      </Dialog>
    )
    
    const buttons = screen.getAllByRole('button')
    
    // Focus should start on first focusable element
    expect(buttons[0]).toHaveFocus()
    
    // Tab through elements
    await user.tab()
    expect(buttons[1]).toHaveFocus()
    
    await user.tab()
    expect(buttons[2]).toHaveFocus()
    
    // Should cycle back to first element
    await user.tab()
    expect(buttons[0]).toHaveFocus()
    
    // Shift+Tab should go backwards
    await user.tab({ shift: true })
    expect(buttons[2]).toHaveFocus()
  })

  it('closes on Escape key', async () => {
    const handleClose = jest.fn()
    const user = userEvent.setup()
    
    render(
      <Dialog open onOpenChange={handleClose}>
        <DialogContent>Dialog content</DialogContent>
      </Dialog>
    )
    
    await user.keyboard('{Escape}')
    expect(handleClose).toHaveBeenCalledWith(false)
  })
})
```

## Testing Custom Hooks

### useLocalStorage Hook Test
```typescript
import { renderHook, act } from '@testing-library/react'
import { useLocalStorage } from '@/hooks/use-local-storage'

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
  })

  it('initializes with default value', () => {
    const { result } = renderHook(() => 
      useLocalStorage('test-key', 'default-value')
    )
    
    expect(result.current[0]).toBe('default-value')
  })

  it('reads existing value from localStorage', () => {
    localStorage.setItem('existing-key', JSON.stringify('existing-value'))
    
    const { result } = renderHook(() => 
      useLocalStorage('existing-key', 'default')
    )
    
    expect(result.current[0]).toBe('existing-value')
  })

  it('updates localStorage when value changes', () => {
    const { result } = renderHook(() => 
      useLocalStorage('update-key', 'initial')
    )
    
    act(() => {
      result.current[1]('updated')
    })
    
    expect(result.current[0]).toBe('updated')
    expect(localStorage.getItem('update-key')).toBe('"updated"')
  })

  it('handles complex objects', () => {
    const { result } = renderHook(() => 
      useLocalStorage('object-key', { name: 'test', count: 0 })
    )
    
    act(() => {
      result.current[1]({ name: 'updated', count: 5 })
    })
    
    expect(result.current[0]).toEqual({ name: 'updated', count: 5 })
  })
})
```

## Testing with Context

### Theme Context Test
```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from '@/contexts/theme-context'

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  
  return (
    <button onClick={toggleTheme}>
      Current theme: {theme}
    </button>
  )
}

describe('ThemeProvider', () => {
  it('provides theme context to children', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>
    )
    
    expect(screen.getByText(/current theme: light/i)).toBeInTheDocument()
  })

  it('toggles theme', async () => {
    const user = userEvent.setup()
    
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>
    )
    
    const button = screen.getByRole('button')
    
    expect(button).toHaveTextContent('Current theme: light')
    
    await user.click(button)
    expect(button).toHaveTextContent('Current theme: dark')
    
    await user.click(button)
    expect(button).toHaveTextContent('Current theme: light')
  })

  it('persists theme to localStorage', async () => {
    const user = userEvent.setup()
    
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>
    )
    
    await user.click(screen.getByRole('button'))
    
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})
```

## Storybook Stories

### Button Stories
```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '@/components/ui/button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
  },
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    children: 'Button',
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Button variant="default">Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex gap-2 items-center">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon">🎯</Button>
    </div>
  ),
}

export const Loading: Story = {
  args: {
    children: (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </>
    ),
    disabled: true,
  },
}

export const AsChild: Story = {
  render: () => (
    <Button asChild>
      <a href="https://example.com" target="_blank">
        External Link
      </a>
    </Button>
  ),
}
```

### Form Stories with Controls
```typescript
// Form.stories.tsx
export const InteractiveForm: Story = {
  render: () => {
    const [formData, setFormData] = useState({})
    
    return (
      <div className="w-96">
        <Form onSubmit={setFormData}>
          {/* Form fields */}
        </Form>
        <pre className="mt-4 p-4 bg-muted rounded">
          {JSON.stringify(formData, null, 2)}
        </pre>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const emailInput = canvas.getByLabelText(/email/i)
    
    await userEvent.type(emailInput, 'test@example.com')
    await userEvent.click(canvas.getByRole('button', { name: /submit/i }))
    
    await waitFor(() => {
      expect(canvas.getByText(/"test@example.com"/)).toBeInTheDocument()
    })
  },
}