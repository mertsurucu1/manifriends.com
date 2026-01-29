// ManiFriends - Home Page Carousel

class GameCarousel {
    constructor() {
        this.currentIndex = 0;
        this.cards = document.querySelectorAll('.game-card');
        this.dots = document.querySelectorAll('.dot');
        this.totalCards = this.cards.length;
        this.isAnimating = false;

        this.init();
    }

    init() {
        // Navigation buttons
        document.getElementById('prevBtn').addEventListener('click', () => this.prev());
        document.getElementById('nextBtn').addEventListener('click', () => this.next());

        // Dot navigation
        this.dots.forEach((dot, index) => {
            dot.addEventListener('click', () => this.goTo(index));
        });

        // Play button
        document.getElementById('playBtn').addEventListener('click', () => this.playGame());

        // Touch/Swipe support
        this.initSwipe();

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.prev();
            if (e.key === 'ArrowRight') this.next();
            if (e.key === 'Enter') this.playGame();
        });

        // Initial update
        this.updateCarousel();
        this.updatePlayButton();
    }

    initSwipe() {
        const carousel = document.getElementById('carousel');
        let startX = 0;
        let isDragging = false;

        const handleStart = (e) => {
            startX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
            isDragging = true;
        };

        const handleEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;

            const endX = e.type === 'mouseup' ? e.clientX : e.changedTouches[0].clientX;
            const diff = startX - endX;

            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    this.next();
                } else {
                    this.prev();
                }
            }
        };

        // Touch events
        carousel.addEventListener('touchstart', handleStart, { passive: true });
        carousel.addEventListener('touchend', handleEnd);

        // Mouse events for desktop
        carousel.addEventListener('mousedown', handleStart);
        carousel.addEventListener('mouseup', handleEnd);
        carousel.addEventListener('mouseleave', () => { isDragging = false; });
    }

    prev() {
        if (this.isAnimating) return;
        this.currentIndex = (this.currentIndex - 1 + this.totalCards) % this.totalCards;
        this.updateCarousel();
    }

    next() {
        if (this.isAnimating) return;
        this.currentIndex = (this.currentIndex + 1) % this.totalCards;
        this.updateCarousel();
    }

    goTo(index) {
        if (this.isAnimating || index === this.currentIndex) return;
        this.currentIndex = index;
        this.updateCarousel();
    }

    updateCarousel() {
        this.isAnimating = true;

        this.cards.forEach((card, index) => {
            card.classList.remove('active', 'prev', 'next', 'hidden');

            if (index === this.currentIndex) {
                card.classList.add('active');
            } else if (index === this.getPrevIndex()) {
                card.classList.add('prev');
            } else if (index === this.getNextIndex()) {
                card.classList.add('next');
            } else {
                card.classList.add('hidden');
            }
        });

        // Update dots
        this.dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === this.currentIndex);
        });

        // Update play button
        this.updatePlayButton();

        // Reset animation lock
        setTimeout(() => {
            this.isAnimating = false;
        }, 500);
    }

    getPrevIndex() {
        return (this.currentIndex - 1 + this.totalCards) % this.totalCards;
    }

    getNextIndex() {
        return (this.currentIndex + 1) % this.totalCards;
    }

    updatePlayButton() {
        const playBtn = document.getElementById('playBtn');
        const currentCard = this.cards[this.currentIndex];
        const gameUrl = currentCard.dataset.url;

        if (gameUrl) {
            playBtn.disabled = false;
            playBtn.textContent = '🎮 OYNA';
        } else {
            playBtn.disabled = true;
            playBtn.textContent = '🔒 YAKINDA';
        }
    }

    playGame() {
        const currentCard = this.cards[this.currentIndex];
        const gameUrl = currentCard.dataset.url;

        if (gameUrl) {
            // Add click animation
            const playBtn = document.getElementById('playBtn');
            playBtn.style.transform = 'scale(0.95)';

            setTimeout(() => {
                window.location.href = gameUrl;
            }, 150);
        }
    }
}

// Initialize carousel when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new GameCarousel();
});
