import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 px-4">
          <div className="p-4 rounded-full bg-destructive/10">
            <AlertTriangle className="h-10 w-10 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold">页面出现错误</h2>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {this.state.error?.message || '发生了未知错误，请尝试刷新页面'}
          </p>
          <Button onClick={this.handleReset} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
