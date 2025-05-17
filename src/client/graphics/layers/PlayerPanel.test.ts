// Tests use Jest and React Testing Library
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PlayerPanel, { PlayerPanelProps } from './PlayerPanel'

describe('PlayerPanel – Rendering', () => {
  it('displays the player name and health correctly', () => {
    const props: PlayerPanelProps = { name: 'Alice', health: 100 }
    render(<PlayerPanel {...props} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Health: 100')).toBeInTheDocument()
  })
})

describe('PlayerPanel – Edge Cases', () => {
  it('shows "Dead" status when health is zero or below', () => {
    const { rerender } = render(<PlayerPanel name="Bob" health={0} />)
    expect(screen.getByText(/Dead/i)).toBeInTheDocument()
    rerender(<PlayerPanel name="Bob" health={-10} />)
    expect(screen.getByText(/Dead/i)).toBeInTheDocument()
  })
})

describe('PlayerPanel – Avatar', () => {
  it('renders a default avatar when avatarUrl is not provided', () => {
    render(<PlayerPanel name="Carol" health={50} />)
    const avatarImg = screen.getByAltText('Carol avatar') as HTMLImageElement
    expect(avatarImg.src).toContain('default-avatar.png')
  })

  it('renders a custom avatar when avatarUrl is provided', () => {
    const url = 'https://example.com/avatar.png'
    render(<PlayerPanel name="Carol" health={50} avatarUrl={url} />)
    expect(screen.getByAltText('Carol avatar')).toHaveAttribute('src', url)
  })
})

describe('PlayerPanel – Updates', () => {
  it('updates health text when the health prop changes', () => {
    const { rerender } = render(<PlayerPanel name="Dave" health={80} />)
    expect(screen.getByText('Health: 80')).toBeInTheDocument()
    rerender(<PlayerPanel name="Dave" health={60} />)
    expect(screen.getByText('Health: 60')).toBeInTheDocument()
  })
})

describe('PlayerPanel – Interactions', () => {
  it('calls onClick when panel is clicked', () => {
    const handleClick = jest.fn()
    render(<PlayerPanel name="Eve" health={90} onClick={handleClick} />)
    fireEvent.click(screen.getByRole('button', { name: /Eve panel/i }))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})

describe('PlayerPanel – Invalid Props', () => {
  it('falls back to "Unknown" when name is empty', () => {
    render(<PlayerPanel name="" health={30} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })
})

afterEach(() => {
  jest.clearAllMocks()
})