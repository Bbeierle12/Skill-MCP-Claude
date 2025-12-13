#!/usr/bin/env python3
"""
Component Generator Script
Generates boilerplate code for shadcn/ui style components
"""

import os
import sys
import argparse
from pathlib import Path

def generate_component(name, variant_type="default"):
    """Generate a React component with shadcn/ui patterns"""
    
    # Convert name to proper formats
    kebab_case = name.lower().replace(" ", "-")
    pascal_case = "".join(word.capitalize() for word in name.split(" "))
    
    # Component template
    component_template = f'''import * as React from "react"
import {{ cva, type VariantProps }} from "class-variance-authority"
import {{ cn }} from "@/lib/utils"

const {kebab_case}Variants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {{
    variants: {{
      variant: {{
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      }},
      size: {{
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
      }},
    }},
    defaultVariants: {{
      variant: "default",
      size: "default",
    }},
  }}
)

export interface {pascal_case}Props
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof {kebab_case}Variants> {{
  asChild?: boolean
}}

const {pascal_case} = React.forwardRef<HTMLDivElement, {pascal_case}Props>(
  ({{ className, variant, size, asChild = false, ...props }}, ref) => {{
    const Comp = asChild ? Slot : "div"
    return (
      <Comp
        className={{cn({kebab_case}Variants({{ variant, size, className }})}}
        ref={{ref}}
        {{...props}}
      />
    )
  }}
)
{pascal_case}.displayName = "{pascal_case}"

export {{ {pascal_case}, {kebab_case}Variants }}
'''

    # Test template
    test_template = f'''import {{ render, screen }} from '@testing-library/react'
import {{ {pascal_case} }} from '@/components/ui/{kebab_case}'

describe('{pascal_case}', () => {{
  it('renders correctly', () => {{
    render(<{pascal_case}>Test Content</{pascal_case}>)
    expect(screen.getByText('Test Content')).toBeInTheDocument()
  }})

  it('applies variant classes', () => {{
    const {{ rerender }} = render(<{pascal_case} variant="outline">Content</{pascal_case}>)
    const element = screen.getByText('Content')
    expect(element).toHaveClass('border')
    
    rerender(<{pascal_case} variant="ghost">Content</{pascal_case}>)
    expect(element).toHaveClass('hover:bg-accent')
  }})

  it('applies size classes', () => {{
    render(<{pascal_case} size="sm">Small</{pascal_case}>)
    const element = screen.getByText('Small')
    expect(element).toHaveClass('h-9')
  }})

  it('forwards ref', () => {{
    const ref = React.createRef<HTMLDivElement>()
    render(<{pascal_case} ref={{ref}}>Ref Test</{pascal_case}>)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  }})
}})
'''

    # Story template
    story_template = f'''import type {{ Meta, StoryObj }} from '@storybook/react'
import {{ {pascal_case} }} from '@/components/ui/{kebab_case}'

const meta: Meta<typeof {pascal_case}> = {{
  title: 'UI/{pascal_case}',
  component: {pascal_case},
  parameters: {{
    layout: 'centered',
  }},
  tags: ['autodocs'],
  argTypes: {{
    variant: {{
      control: 'select',
      options: ['default', 'secondary', 'outline', 'ghost'],
    }},
    size: {{
      control: 'select',
      options: ['default', 'sm', 'lg'],
    }},
  }},
}}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {{
  args: {{
    children: '{pascal_case} Component',
  }},
}}

export const AllVariants: Story = {{
  render: () => (
    <div className="flex gap-4 flex-wrap">
      <{pascal_case} variant="default">Default</{pascal_case}>
      <{pascal_case} variant="secondary">Secondary</{pascal_case}>
      <{pascal_case} variant="outline">Outline</{pascal_case}>
      <{pascal_case} variant="ghost">Ghost</{pascal_case}>
    </div>
  ),
}}

export const AllSizes: Story = {{
  render: () => (
    <div className="flex gap-4 items-center">
      <{pascal_case} size="sm">Small</{pascal_case}>
      <{pascal_case} size="default">Default</{pascal_case}>
      <{pascal_case} size="lg">Large</{pascal_case}>
    </div>
  ),
}}
'''

    return {
        'component': component_template,
        'test': test_template,
        'story': story_template,
        'kebab_case': kebab_case,
        'pascal_case': pascal_case
    }

def main():
    parser = argparse.ArgumentParser(description='Generate shadcn/ui style React components')
    parser.add_argument('name', help='Component name (e.g., "Button" or "Data Table")')
    parser.add_argument('--output-dir', default='./components/ui', help='Output directory for component')
    parser.add_argument('--with-tests', action='store_true', help='Generate test file')
    parser.add_argument('--with-story', action='store_true', help='Generate Storybook story')
    
    args = parser.parse_args()
    
    # Generate component files
    templates = generate_component(args.name)
    
    # Create output directory if it doesn't exist
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Write component file
    component_file = output_dir / f"{templates['kebab_case']}.tsx"
    with open(component_file, 'w') as f:
        f.write(templates['component'])
    print(f"✅ Created component: {component_file}")
    
    # Write test file if requested
    if args.with_tests:
        test_dir = output_dir.parent / '__tests__' / 'components'
        test_dir.mkdir(parents=True, exist_ok=True)
        test_file = test_dir / f"{templates['kebab_case']}.test.tsx"
        with open(test_file, 'w') as f:
            f.write(templates['test'])
        print(f"✅ Created test: {test_file}")
    
    # Write story file if requested
    if args.with_story:
        story_file = output_dir / f"{templates['kebab_case']}.stories.tsx"
        with open(story_file, 'w') as f:
            f.write(templates['story'])
        print(f"✅ Created story: {story_file}")
    
    print(f"\n🎉 Successfully generated {templates['pascal_case']} component!")
    print("\nNext steps:")
    print(f"1. Import component: import {{ {templates['pascal_case']} }} from '@/components/ui/{templates['kebab_case']}'")
    print(f"2. Use in your code: <{templates['pascal_case']}>Content</{templates['pascal_case']}>")

if __name__ == "__main__":
    main()
