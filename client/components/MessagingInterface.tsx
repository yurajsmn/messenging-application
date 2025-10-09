'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  doc,
  setDoc,
  getDocs,
  getDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Phone, Video, MoreVertical, Send, UserPlus, LogOut, Settings as SettingsIcon, User, RefreshCw } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import LoadingSpinner from './LoadingSpinner';
import { toast } from 'react-hot-toast';
import CallInterface from './CallInterface';
import FileMessage from './FileMessage';
import Settings from './Settings';
import WhatsAppMessageInput from './WhatsAppMessageInput';

import { CloudinaryUploadedFile, getFileCategory, formatFileSize } from '@/lib/cloudinaryUpload';
import { useSocket } from './SocketProvider';

interface Message {
  id: string;
  text: string;
  senderId: string;
  receiverId: string;
  timestamp: any;
  conversationId: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}

interface Contact {
  uid: string;
  name: string;
  email: string;
  online: boolean;
  lastSeen: any;
  lastMessage?: string;
  lastMessageTime?: any;
  unreadCount?: number;
}

interface Conversation {
  id: string;
  userIds: string[];
  lastMessage: string;
  lastUpdated: any;
  lastMessageSenderId: string;
}

export default function MessagingInterface() {
  const { currentUser, userProfile, logout } = useAuth();
  const { socket, isConnected } = useSocket();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [isCallActive, setIsCallActive] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Fetch contacts and conversations
  useEffect(() => {
    if (!currentUser) return;

    const fetchContacts = async () => {
      try {
        // First, get user's contacts (only people they've added or messaged)
        const conversationsQuery = query(
          collection(db, 'conversations'),
          where('userIds', 'array-contains', currentUser.uid)
        );

        const unsubscribe = onSnapshot(conversationsQuery, async (snapshot) => {
          const conversations = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Conversation[];

          // Get unique contact UIDs from conversations
          const contactUids = new Set<string>();
          conversations.forEach(conv => {
            conv.userIds.forEach(uid => {
              if (uid !== currentUser.uid) {
                contactUids.add(uid);
              }
            });
          });

          // If no contacts found, show empty state
          if (contactUids.size === 0) {
            setContacts([]);
            setLoading(false);
            return;
          }

          // Fetch contact details for each UID
          const contactPromises = Array.from(contactUids).map(async (uid) => {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) {
              return { uid, ...userDoc.data() } as Contact;
            }
            return null;
          });

          const contactsData = (await Promise.all(contactPromises)).filter(Boolean) as Contact[];

          // Enrich contacts with conversation data
          const enrichedContacts = contactsData.map(user => {
            const conversation = conversations.find(conv => 
              conv.userIds.includes(user.uid)
            );
            
            return {
              ...user,
              lastMessage: conversation?.lastMessage || '',
              lastMessageTime: conversation?.lastUpdated,
              unreadCount: 0 // TODO: Implement unread count
            };
          });

          // Sort by last message time
          enrichedContacts.sort((a, b) => {
            if (!a.lastMessageTime) return 1;
            if (!b.lastMessageTime) return -1;
            return b.lastMessageTime.seconds - a.lastMessageTime.seconds;
          });

          setContacts(enrichedContacts);
          setLoading(false);
        });

        return () => unsubscribe();
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setLoading(false);
      }
    };

    fetchContacts();
  }, [currentUser]);

  // Listen to messages for selected conversation
  useEffect(() => {
    if (!currentUser || !selectedContact) return;

    const conversationId = [currentUser.uid, selectedContact.uid].sort().join('_');
    
    const messagesQuery = query(
      collection(db, 'conversations', conversationId, 'messages'),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const messagesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      
      setMessages(messagesData);
    });

    return () => unsubscribe();
  }, [currentUser, selectedContact]);

  const sendMessage = async (fileData: CloudinaryUploadedFile) => {
    if (!currentUser || !selectedContact || !fileData) return;

    try {
      const conversationId = [currentUser.uid, selectedContact.uid].sort().join('_');
      
      const messageData: any = {
        text: `Shared ${fileData.name}`,
        senderId: currentUser.uid,
        receiverId: selectedContact.uid,
        timestamp: serverTimestamp(),
        conversationId,
        fileUrl: fileData.url,
        fileName: fileData.name,
        fileSize: fileData.size,
        fileType: fileData.type,
        // Additional Cloudinary-specific data
        publicId: fileData.publicId,
        resourceType: fileData.resourceType,
        format: fileData.format,
        // Only include optional fields if they exist
        ...(fileData.width && { width: fileData.width }),
        ...(fileData.height && { height: fileData.height }),
        ...(fileData.duration && { duration: fileData.duration })
      };

      // Add message to subcollection
      await addDoc(collection(db, 'conversations', conversationId, 'messages'), messageData);

      // Update or create conversation document
      const lastMessage = `📎 ${fileData.name}`;

      await setDoc(doc(db, 'conversations', conversationId), {
        userIds: [currentUser.uid, selectedContact.uid],
        lastMessage,
        lastUpdated: serverTimestamp(),
        lastMessageSenderId: currentUser.uid
      }, { merge: true });

    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    }
  };

  const addNewUser = async () => {
    if (!newUserEmail.trim()) return;

    try {
      // Search for user by email in Firebase users collection
      const usersQuery = query(
        collection(db, 'users'),
        where('email', '==', newUserEmail.trim().toLowerCase())
      );
      
      const usersSnapshot = await getDocs(usersQuery);
      
      if (usersSnapshot.empty) {
        toast.error('User not found with this email address');
        return;
      }

      const userData = usersSnapshot.docs[0].data();
      const userUid = usersSnapshot.docs[0].id;

      // Check if already added
      const existingContact = contacts.find(contact => contact.uid === userUid);
      if (existingContact) {
        toast.error('User is already in your contacts');
        return;
      }

      // Ensure currentUser exists
      if (!currentUser) {
        toast.error('You must be logged in to add contacts');
        return;
      }

      // Create a conversation to establish connection
      const conversationId = [currentUser.uid, userUid].sort().join('_');
      await setDoc(doc(db, 'conversations', conversationId), {
        userIds: [currentUser.uid, userUid],
        lastMessage: '',
        lastUpdated: serverTimestamp(),
        lastMessageSenderId: null
      }, { merge: true });

      setNewUserEmail('');
      setNewUserName('');
      setShowAddUser(false);
      
      toast.success(`${userData.name} added to your contacts!`);
    } catch (error) {
      console.error('Error adding user:', error);
      toast.error('Failed to add user');
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const getContactColor = (name: string) => {
    const colors = ['bg-blue-500', 'bg-pink-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500', 'bg-red-500'];
    const index = name.length % colors.length;
    return colors[index];
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    
    if (isToday(date)) {
      return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
      return 'Yesterday';
    } else {
      return format(date, 'MMM dd');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out successfully');
      // Force navigation to login page after logout
      window.location.href = '/auth/login';
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('Failed to logout');
    }
  };

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Please log in to continue</h2>
          <p className="text-gray-600">You need to be authenticated to access the messaging interface.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Contacts Sidebar */}
      <div className="w-1/3 bg-white border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold">Messages</h1>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowAddUser(true)}
                className="p-2 hover:bg-gray-100 rounded-full text-blue-500"
                title="Add new contact"
              >
                <UserPlus size={20} />
              </button>
              <div className="relative">
                <button 
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="p-2 hover:bg-gray-100 rounded-full"
                >
                  <MoreVertical size={20} className="text-gray-600" />
                </button>
                
                {showUserMenu && (
                  <div 
                    ref={userMenuRef}
                    className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50"
                  >
                    <div className="py-1">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <p className="text-sm font-medium text-gray-900">{userProfile?.name || 'User'}</p>
                        <p className="text-xs text-gray-500">{userProfile?.email}</p>
                      </div>
                      <button
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowSettings(true);
                        }}
                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <SettingsIcon size={16} className="mr-3" />
                        Settings
                      </button>
                      <button
                        onClick={() => {
                          setShowUserMenu(false);
                          handleLogout();
                        }}
                        className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        <LogOut size={16} className="mr-3" />
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Search */}
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search contacts"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <LoadingSpinner text="Loading contacts..." />
          ) : filteredContacts.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <p>No contacts found</p>
              <p className="text-sm mt-1">Register users or add contacts to get started</p>
            </div>
          ) : (
            filteredContacts.map((contact) => (
            <div
              key={contact.uid}
              onClick={() => setSelectedContact(contact)}
              className={`contact-item ${selectedContact?.uid === contact.uid ? 'active' : ''}`}
            >
              <div className="relative">
                <div className={`w-12 h-12 ${getContactColor(contact.name)} rounded-full flex items-center justify-center text-white font-medium`}>
                  {getInitials(contact.name)}
                </div>
                {contact.online && (
                  <div className="online-indicator absolute -bottom-1 -right-1"></div>
                )}
              </div>
              
              <div className="ml-3 flex-1 min-w-0">
                <div className="flex justify-between items-start">
                  <h3 className="font-medium text-gray-900 truncate">{contact.name}</h3>
                  <span className="text-xs text-gray-500">
                    {formatTime(contact.lastMessageTime)}
                  </span>
                </div>
                <p className="text-sm text-gray-500 truncate">
                  {contact.lastMessage || 'No messages yet'}
                </p>
              </div>
            </div>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedContact ? (
          <>
            {/* Chat Header */}
            <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center">
                <div className={`w-10 h-10 ${getContactColor(selectedContact.name)} rounded-full flex items-center justify-center text-white font-medium`}>
                  {getInitials(selectedContact.name)}
                </div>
                <div className="ml-3">
                  <h2 className="font-medium text-gray-900">{selectedContact.name}</h2>
                  <div className="flex items-center space-x-2">
                    <p className="text-sm text-gray-500">
                      {selectedContact.online ? 'Online' : 'Offline'}
                    </p>
                    {!isConnected && (
                      <span className="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded-full">
                        Offline Mode
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {!isConnected && (
                  <button 
                    onClick={() => window.location.reload()}
                    className="p-2 hover:bg-gray-100 rounded-full text-orange-600"
                    title="Refresh to check for new messages"
                  >
                    <RefreshCw size={18} />
                  </button>
                )}
                <CallInterface
                  recipientId={selectedContact.uid}
                  recipientName={selectedContact.name}
                  onCallEnd={() => setIsCallActive(false)}
                  onCallStart={() => setIsCallActive(true)}
                />
                <button className="p-2 hover:bg-gray-100 rounded-full">
                  <MoreVertical size={20} className="text-gray-600" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4 mx-auto">
                      <Send size={24} className="text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No messages yet</h3>
                    <p className="text-gray-500">Start a conversation with {selectedContact.name}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-center">
                    <span className="text-sm text-gray-500 bg-gray-200 px-3 py-1 rounded-full">
                      Today
                    </span>
                  </div>
                  
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.senderId === currentUser.uid ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`chat-message ${message.senderId === currentUser.uid ? 'sent' : 'received'}`}>
                        {message.fileUrl ? (
                          <FileMessage
                            fileUrl={message.fileUrl}
                            fileName={message.fileName || 'Unknown File'}
                            fileSize={message.fileSize || 0}
                            fileType={message.fileType || 'application/octet-stream'}
                            timestamp={message.timestamp}
                            formatTime={formatTime}
                          />
                        ) : (
                          <>
                            <p className="text-sm">{message.text}</p>
                            <div className="text-xs opacity-70 mt-1">
                              {formatTime(message.timestamp)}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            

            {/* WhatsApp-style Message Input */}
            <WhatsAppMessageInput
              onSendMessage={async (message, file) => {
                if (message) {
                  // Send text message
                  try {
                    const conversationId = [currentUser.uid, selectedContact.uid].sort().join('_');
                    
                    await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
                      text: message,
                      senderId: currentUser.uid,
                      receiverId: selectedContact.uid,
                      timestamp: serverTimestamp(),
                      conversationId
                    });

                    await setDoc(doc(db, 'conversations', conversationId), {
                      userIds: [currentUser.uid, selectedContact.uid],
                      lastMessage: message,
                      lastUpdated: serverTimestamp(),
                      lastMessageSenderId: currentUser.uid
                    }, { merge: true });

                  } catch (error) {
                    console.error('Error sending message:', error);
                    toast.error('Failed to send message');
                  }
                } else if (file) {
                  // Send file message
                  sendMessage(file);
                }
              }}
              userId={currentUser.uid}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-4 mx-auto">
                <Search size={32} className="text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a conversation</h3>
              <p className="text-gray-500">Choose from your existing conversations or start a new one</p>
            </div>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Add Contact</h2>
              <button
                onClick={() => setShowAddUser(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter email address of user to add"
                />
                <p className="text-xs text-gray-500 mt-1">
                  User must have an account with this email
                </p>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowAddUser(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={addNewUser}
                disabled={!newUserEmail.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Contact
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Settings Modal */}
      {showSettings && (
        <Settings onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
} 