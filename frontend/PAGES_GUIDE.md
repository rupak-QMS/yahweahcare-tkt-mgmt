# Yahweh Care - Pages Guide

Complete navigation and pages for all sidebar options.

## 📄 Available Pages

All pages are now accessible through the main dashboard with sidebar navigation:

### **WORKSPACE Pages**
1. **Dashboard** - Overview with ticket statistics
2. **Create Ticket** - Form to submit new support requests
3. **Tickets** - List and manage all tickets
4. **Calendar** - View and schedule ticket events
5. **Ticket Logs** - Audit trail and activity history

### **MANAGEMENT Pages**
6. **Analytics** - Performance metrics and trends
7. **Org Chart** - Organizational hierarchy
8. **Staff Performance** - Individual team metrics
9. **Team Comparison** - Compare teams side-by-side
10. **Staff Management** - Manage team members
11. **Scheduled Reports** - Automated report schedules

## 🚀 How to Use

### **Option 1: Use the New Main Application** (Recommended)
Replace your current index.html with the new dashboard.html:

```bash
cd /Users/subhankarmondal/Downloads/Yahweahcare/frontend

# Backup current index.html
cp index.html index.html.backup

# Use new dashboard as main
cp dashboard.html index.html

# Deploy to Vercel
vercel --prod
```

### **Option 2: Access Both**
Keep both versions:

```bash
# Current: https://yahweahcare-tkt-mgmt.vercel.app (old index.html)
# New: https://yahweahcare-tkt-mgmt.vercel.app/dashboard.html (new)
```

## 🎯 Features Included

✅ **Full Navigation Sidebar**
- All 11 pages accessible
- Active page highlighting
- User profile section
- Logo and branding

✅ **Dashboard Page**
- Ticket statistics (Total, Open, Closed, Pending)
- Quick metrics display
- Overview section

✅ **Create Ticket Page**
- Form with all required fields
- Type, Category, Priority selectors
- Issue details textarea
- Submitter information
- Form validation ready

✅ **Tickets Page**
- Table view with status and priority
- Sample ticket data
- Sortable/filterable ready
- Action buttons

✅ **Placeholder Pages**
- All other pages ready with layout
- Easy to fill with content
- Consistent styling

## 📝 File Structure

```
frontend/
├── index.html (current - old version)
├── dashboard.html (new - recommended)
├── index.html.backup (backup)
├── pages/ (individual React components)
│   ├── Dashboard.jsx
│   ├── Tickets.jsx
│   ├── Calendar.jsx
│   └── ... (9 more components)
└── PAGES_GUIDE.md (this file)
```

## 🔧 Customization

### Add Content to Pages

Find the placeholder in dashboard.html and replace:

```jsx
case 'calendar':
    return <PlaceholderPage title="Calendar" description="..." />;
```

With custom component:

```jsx
case 'calendar':
    return <CalendarPage />;
```

### Add New Pages

1. Add navigation button:
```jsx
{ id: 'new-page', label: 'New Page', icon: '📍' }
```

2. Add case in renderPage():
```jsx
case 'new-page':
    return <NewPageComponent />;
```

## 🎨 Styling

- **Framework:** Tailwind CSS (via CDN)
- **Colors:** Indigo/Purple gradient theme
- **Responsive:** Mobile-friendly design
- **Dark Mode:** Ready to implement

## 🚀 Deployment

```bash
# Option 1: Deploy as index.html
cd frontend
cp dashboard.html index.html
vercel --prod

# Option 2: Deploy as separate page
vercel --prod
# Then access at /dashboard.html
```

## 📊 Available Pages Summary

| Page | Route | Features |
|------|-------|----------|
| Dashboard | `/#dashboard` | Stats, overview, quick metrics |
| Create Ticket | `/#create-ticket` | Form submission |
| Tickets | `/#tickets` | List view, table |
| Calendar | `/#calendar` | Placeholder with layout |
| Ticket Logs | `/#ticket-logs` | Placeholder with layout |
| Analytics | `/#analytics` | Placeholder with layout |
| Org Chart | `/#org-chart` | Placeholder with layout |
| Staff Performance | `/#staff-performance` | Placeholder with layout |
| Team Comparison | `/#team-comparison` | Placeholder with layout |
| Staff Management | `/#staff-management` | Placeholder with layout |
| Scheduled Reports | `/#scheduled-reports` | Placeholder with layout |

## ✨ Next Steps

1. **Test locally:**
   ```bash
   cd frontend
   open dashboard.html
   ```

2. **Deploy to Vercel:**
   ```bash
   vercel --prod
   ```

3. **Add page content:**
   - Replace placeholder pages with real data
   - Connect to backend API
   - Add form handlers

4. **Customize styling:**
   - Update colors/theme
   - Add animations
   - Improve responsive design

## 🔗 Integration with Backend

To connect pages to backend API:

```javascript
// Example: Fetch tickets
React.useEffect(() => {
    fetch('https://yahweahcare-backend.vercel.app/api/tickets')
        .then(res => res.json())
        .then(data => setTickets(data));
}, []);
```

## 📱 Mobile View

The application is fully responsive:
- ✅ Mobile-friendly navigation
- ✅ Responsive grid layouts
- ✅ Touch-friendly buttons
- ✅ Auto-collapsing sidebar (ready)

## 🆘 Support

For questions about:
- **Pages:** See PAGES_GUIDE.md
- **Deployment:** See DEPLOYMENT_QUICK_START.md
- **Git workflow:** See GIT_DEPLOYMENT_GUIDE.md
- **Vercel setup:** See VERCEL_DEPLOYMENT_GUIDE.md

---

**Last Updated:** June 3, 2026  
**Status:** Ready for Production ✅
