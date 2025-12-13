# Advanced Form Patterns

Comprehensive patterns for complex form implementations with React Hook Form.

## Form Validation Patterns

### Zod Schema Integration
```typescript
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"

const formSchema = z.object({
  username: z.string().min(2, "Username must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  age: z.number().min(18).max(100),
  website: z.string().url().optional(),
  bio: z.string().max(160).optional(),
  notifications: z.object({
    email: z.boolean(),
    push: z.boolean(),
    sms: z.boolean(),
  }),
  role: z.enum(["admin", "user", "guest"]),
  startDate: z.date(),
  skills: z.array(z.string()).min(1, "Select at least one skill"),
})

type FormData = z.infer<typeof formSchema>

const form = useForm<FormData>({
  resolver: zodResolver(formSchema),
  defaultValues: {
    notifications: {
      email: true,
      push: false,
      sms: false,
    },
    skills: [],
  },
})
```

### Custom Validation Rules
```typescript
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character")

const confirmPasswordSchema = z.object({
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
})
```

## Multi-Step Form Pattern

```typescript
import { useState } from "react"
import { FormProvider, useForm } from "react-hook-form"

interface MultiStepFormData {
  // Step 1: Personal Info
  firstName: string
  lastName: string
  email: string
  
  // Step 2: Address
  street: string
  city: string
  state: string
  zipCode: string
  
  // Step 3: Preferences
  newsletter: boolean
  notifications: boolean
  theme: "light" | "dark" | "system"
}

export function MultiStepForm() {
  const [currentStep, setCurrentStep] = useState(0)
  const methods = useForm<MultiStepFormData>({
    mode: "onChange",
    defaultValues: {
      newsletter: false,
      notifications: true,
      theme: "system",
    },
  })

  const steps = [
    {
      id: "personal",
      title: "Personal Information",
      fields: ["firstName", "lastName", "email"],
    },
    {
      id: "address", 
      title: "Address",
      fields: ["street", "city", "state", "zipCode"],
    },
    {
      id: "preferences",
      title: "Preferences",
      fields: ["newsletter", "notifications", "theme"],
    },
  ]

  const next = async () => {
    const fields = steps[currentStep].fields
    const output = await methods.trigger(fields as any)
    
    if (!output) return
    
    if (currentStep < steps.length - 1) {
      setCurrentStep(step => step + 1)
    }
  }

  const previous = () => {
    if (currentStep > 0) {
      setCurrentStep(step => step - 1)
    }
  }

  const onSubmit = (data: MultiStepFormData) => {
    console.log("Form submitted:", data)
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)}>
        <div className="space-y-4">
          {/* Progress indicator */}
          <div className="flex justify-between mb-8">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  "flex-1 text-center pb-2 border-b-2 transition-colors",
                  index <= currentStep
                    ? "border-primary text-primary"
                    : "border-muted text-muted-foreground"
                )}
              >
                {step.title}
              </div>
            ))}
          </div>

          {/* Step content */}
          {currentStep === 0 && <PersonalInfoStep />}
          {currentStep === 1 && <AddressStep />}
          {currentStep === 2 && <PreferencesStep />}

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            <Button
              type="button"
              variant="outline"
              onClick={previous}
              disabled={currentStep === 0}
            >
              Previous
            </Button>
            
            {currentStep === steps.length - 1 ? (
              <Button type="submit">Submit</Button>
            ) : (
              <Button type="button" onClick={next}>
                Next
              </Button>
            )}
          </div>
        </div>
      </form>
    </FormProvider>
  )
}
```

## Dynamic Field Arrays

```typescript
import { useFieldArray, useForm } from "react-hook-form"
import { Plus, Trash2 } from "lucide-react"

interface FormData {
  items: Array<{
    name: string
    quantity: number
    price: number
  }>
}

export function DynamicFieldArray() {
  const { control, register, handleSubmit, watch } = useForm<FormData>({
    defaultValues: {
      items: [{ name: "", quantity: 1, price: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  })

  const watchItems = watch("items")
  const total = watchItems.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.price || 0),
    0
  )

  return (
    <form onSubmit={handleSubmit(console.log)} className="space-y-4">
      {fields.map((field, index) => (
        <div key={field.id} className="flex gap-2 items-end">
          <div className="flex-1">
            <Label htmlFor={`items.${index}.name`}>Item Name</Label>
            <Input
              {...register(`items.${index}.name` as const, {
                required: "Item name is required",
              })}
              placeholder="Enter item name"
            />
          </div>

          <div className="w-24">
            <Label htmlFor={`items.${index}.quantity`}>Qty</Label>
            <Input
              type="number"
              {...register(`items.${index}.quantity` as const, {
                valueAsNumber: true,
                min: { value: 1, message: "Min quantity is 1" },
              })}
            />
          </div>

          <div className="w-32">
            <Label htmlFor={`items.${index}.price`}>Price</Label>
            <Input
              type="number"
              step="0.01"
              {...register(`items.${index}.price` as const, {
                valueAsNumber: true,
                min: { value: 0, message: "Price must be positive" },
              })}
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(index)}
            disabled={fields.length === 1}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <div className="flex justify-between items-center pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ name: "", quantity: 1, price: 0 })}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Item
        </Button>

        <div className="text-lg font-semibold">
          Total: ${total.toFixed(2)}
        </div>
      </div>

      <Button type="submit" className="w-full">
        Submit Order
      </Button>
    </form>
  )
}
```

## Conditional Fields Pattern

```typescript
export function ConditionalForm() {
  const { register, watch, control } = useForm({
    defaultValues: {
      accountType: "personal",
      firstName: "",
      lastName: "",
      companyName: "",
      taxId: "",
      hasShippingAddress: false,
      billingAddress: "",
      shippingAddress: "",
    },
  })

  const accountType = watch("accountType")
  const hasShippingAddress = watch("hasShippingAddress")

  return (
    <form className="space-y-4">
      <div>
        <Label>Account Type</Label>
        <RadioGroup defaultValue="personal" {...register("accountType")}>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="personal" id="personal" />
            <Label htmlFor="personal">Personal</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="business" id="business" />
            <Label htmlFor="business">Business</Label>
          </div>
        </RadioGroup>
      </div>

      {accountType === "personal" ? (
        <>
          <Input {...register("firstName")} placeholder="First Name" />
          <Input {...register("lastName")} placeholder="Last Name" />
        </>
      ) : (
        <>
          <Input {...register("companyName")} placeholder="Company Name" />
          <Input {...register("taxId")} placeholder="Tax ID" />
        </>
      )}

      <div>
        <Label htmlFor="billing">Billing Address</Label>
        <Textarea {...register("billingAddress")} id="billing" />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox 
          id="shipping"
          {...register("hasShippingAddress")}
        />
        <Label htmlFor="shipping">
          Ship to a different address
        </Label>
      </div>

      {hasShippingAddress && (
        <div>
          <Label htmlFor="shipping-address">Shipping Address</Label>
          <Textarea {...register("shippingAddress")} id="shipping-address" />
        </div>
      )}
    </form>
  )
}
```

## Auto-Save Pattern

```typescript
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { debounce } from "lodash"

export function AutoSaveForm() {
  const { register, watch, formState } = useForm({
    defaultValues: async () => {
      // Load from localStorage or API
      const saved = localStorage.getItem("draft")
      return saved ? JSON.parse(saved) : {}
    },
  })

  const formData = watch()

  useEffect(() => {
    const saveDraft = debounce((data) => {
      localStorage.setItem("draft", JSON.stringify(data))
      console.log("Draft saved")
    }, 1000)

    const subscription = watch((data) => {
      if (formState.isDirty) {
        saveDraft(data)
      }
    })

    return () => {
      subscription.unsubscribe()
      saveDraft.cancel()
    }
  }, [watch, formState.isDirty])

  return (
    <form className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {formState.isDirty ? "Saving..." : "All changes saved"}
      </div>
      
      <Input {...register("title")} placeholder="Title" />
      <Textarea {...register("content")} placeholder="Content" rows={10} />
    </form>
  )
}
```

## File Upload with Preview

```typescript
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Upload, X } from "lucide-react"

interface FormData {
  files: FileList
  description: string
}

export function FileUploadForm() {
  const [previews, setPreviews] = useState<string[]>([])
  const { register, handleSubmit, setValue, watch } = useForm<FormData>()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newPreviews: string[] = []
    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader()
        reader.onloadend = () => {
          newPreviews.push(reader.result as string)
          setPreviews([...newPreviews])
        }
        reader.readAsDataURL(file)
      }
    })
  }

  const removeFile = (index: number) => {
    const newPreviews = [...previews]
    newPreviews.splice(index, 1)
    setPreviews(newPreviews)
  }

  return (
    <form onSubmit={handleSubmit(console.log)} className="space-y-4">
      <div>
        <Label htmlFor="files">Upload Files</Label>
        <div className="mt-2">
          <label
            htmlFor="files"
            className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent"
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="mt-2 text-sm text-muted-foreground">
              Click to upload or drag and drop
            </span>
            <input
              id="files"
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              {...register("files")}
              onChange={handleFileChange}
            />
          </label>
        </div>
      </div>

      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {previews.map((preview, index) => (
            <div key={index} className="relative group">
              <img
                src={preview}
                alt={`Preview ${index + 1}`}
                className="w-full h-24 object-cover rounded"
              />
              <button
                type="button"
                onClick={() => removeFile(index)}
                className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Textarea
        {...register("description")}
        placeholder="Add a description..."
        rows={3}
      />

      <Button type="submit">Upload Files</Button>
    </form>
  )
}
```